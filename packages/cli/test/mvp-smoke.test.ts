/**
 * MVP fake-runtime smoke flow (MIK-014).
 *
 * This is the integration-hardening pass that proves the implemented slices work
 * *together* — not just in isolation — without ever touching a real multiplexer
 * or agent CLI. It lives in `@asem/cli` because the CLI is the integrator that
 * depends on every surface (`@asem/ops`, `@asem/mcp`, `@asem/tui`); the suite is
 * deliberately cross-package, so the single semantic spine (`@asem/ops`) and its
 * three projections (CLI / MCP / TUI) are all exercised over one shared in-memory
 * store and filesystem (testability rules; AGENTS.md "Testability rules").
 *
 * Every dependency is a fake from the `@asem/ops` test fakes — Store, FileSystem,
 * ConfigLoader, ScopeResolver, CurrentSessionResolver, Clock, Id/Token generators,
 * Logger — plus the runtime `FakeTemplateRunner`. Nothing here requires herdr,
 * tmux, rmux, zellij, or any agent binary. The opt-in real-mux/agent checks live in
 * `@asem/runtime` (`ASEM_MUX_INTEGRATION=1` / `ASEM_AGENT_INTEGRATION=1`) and skip
 * when the binary is absent.
 *
 * The flow walks the documented operation table end to end:
 *   init → init-session → create-session → list/get → send-message →
 *   report-parent → message-list → close → delete, then projects the same store
 *   through MCP tools, the TUI cockpit, and the CLI surface. It also asserts the
 *   security/state invariants: token-bearing files are mode 0600 under ignored
 *   paths, the current-session pointer excludes the raw token, and no raw token
 *   ever reaches the log stream (secret redaction).
 */
import { describe, expect, test } from "bun:test";
import type {
  EffectiveScope,
  Message,
  MuxRef,
  OperationError,
  OperationResult,
  Session,
} from "@asem/core";
import {
  callMcpTool,
  hasMcpTool,
  listMcpTools,
  type McpToolResult,
} from "@asem/mcp";
import {
  closeSession,
  configPathFor,
  createSession,
  currentSessionFileFor,
  deleteSession,
  getSession,
  gitignorePathFor,
  initProject,
  initSession,
  listMessages,
  listSessions,
  type OpsDeps,
  RUNTIME_GITIGNORE_RULES,
  reportParent,
  sendMessage,
  sessionDirFor,
  TOKEN_FILE_MODE,
  tokenFileFor,
} from "@asem/ops";
import { FakeTemplateRunner } from "@asem/runtime";
import {
  type AttachRequest,
  type CockpitHost,
  type CockpitView,
  type KeyEvent,
  runCockpit,
} from "@asem/tui";
import {
  FakeClock,
  FakeCurrentSessionResolver,
  FakeFileSystem,
  FakeIdGenerator,
  FakeScopeResolver,
  FakeStore,
  FakeTokenGenerator,
  MemoryLogger,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import { BufferIo } from "../src/io.ts";
import { EXIT_OK, runCli } from "../src/run.ts";

// --- fixtures -------------------------------------------------------------

const CWD = "/repo/a";
const SCOPE: EffectiveScope = { workspaceId: "ws_1", worktreeRoot: CWD };
const CTX = { cwd: CWD };
// A herdr-shaped mux ref captured from the owning herdr workspace.
const MUX_REF: MuxRef = {
  pane_id: "pane-1",
  tab_id: "tab-1",
  herdr_workspace_id: "herdr-workspace-1",
  herdr_session: "asem",
};

/** Minimal `herdr workspace create` JSON the builtin herdr template captures refs from. */
const HERDR_CREATE_JSON = JSON.stringify({
  result: {
    workspace: { workspace_id: "herdr-workspace-1" },
    root_pane: { pane_id: "pane-1" },
    tab: { tab_id: "tab-1" },
  },
});

function expectOk<T>(result: OperationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function expectErr<T>(
  result: OperationResult<T>,
  code: OperationError["code"],
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected error ${code}, got ok`);
  expect(result.error.code).toBe(code);
}

/** A scripted {@link CockpitHost} for the TUI projection: no real terminal. */
class SmokeHost implements CockpitHost {
  readonly frames: CockpitView[] = [];
  closed = false;
  private readonly keys: (KeyEvent | null)[];

  constructor(keys: (KeyEvent | null)[]) {
    this.keys = [...keys];
  }

  draw(view: CockpitView): void {
    this.frames.push(view);
  }

  nextKey(): Promise<KeyEvent | null> {
    return Promise.resolve(this.keys.length === 0 ? null : this.keys.shift()!);
  }

  async attach(_request: AttachRequest): Promise<void> {}

  close(): void {
    this.closed = true;
  }
}

interface World {
  store: FakeStore;
  fs: FakeFileSystem;
  logger: MemoryLogger;
  currentSession: FakeCurrentSessionResolver;
  base: OpsDeps;
  ids: { orch: string; reviewer: string; helper: string };
  tokens: { orch: string; reviewer: string; helper: string };
}

/** Build a fresh harness of shared fakes (one store, fs, logger, clock, …). */
function makeHarness() {
  const store = new FakeStore();
  const fs = new FakeFileSystem();
  const logger = new MemoryLogger();
  const currentSession = new FakeCurrentSessionResolver(null);
  const base = makeOpsDeps({
    store,
    fs,
    logger,
    currentSessionResolver: currentSession,
    scopeResolver: new FakeScopeResolver(SCOPE),
    clock: new FakeClock(),
    idGenerator: new FakeIdGenerator(),
    tokenGenerator: new FakeTokenGenerator(),
  });
  return { store, fs, logger, currentSession, base };
}

/** A deps bundle whose mux `create` step returns the herdr ref JSON. */
function withCreateRunner(base: OpsDeps): OpsDeps {
  return {
    ...base,
    templateRunner: new FakeTemplateRunner({
      commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
    }),
  };
}

/**
 * Run the non-destructive spine: init → register two Sessions → create a third
 * via templates → exchange three Messages. The destructive close/delete and the
 * surface projections each start from this seeded world so the tests stay
 * independent (no ordered-test coupling).
 *
 * Deterministic fakes give stable ids/tokens: root-1 (s_0001 / tok_0001),
 * reviewer-1 (s_0002 / tok_0002), helper-1 (s_0003 / tok_0003).
 */
async function seedWorld(): Promise<World> {
  const h = makeHarness();
  const { base, currentSession } = h;

  // 1. init project — writes .asem.yaml + runtime ignore rules into the fake fs.
  expectOk(await initProject(base, { cwd: CWD, workspaceId: "ws_1" }));

  // 2. init-session: register the current agent as a root Session.
  currentSession.ref = null;
  const orch = expectOk(
    await initSession(base, { name: "root-1", muxRef: MUX_REF }, CTX),
  );

  // 3. init-session: register a child Session (so report-parent has a parent).
  const reviewer = expectOk(
    await initSession(
      base,
      {
        name: "reviewer-1",
        muxRef: MUX_REF,
        parentSessionId: orch.session.id,
      },
      CTX,
    ),
  );

  // 4. create-session: launch a third Session through the templates. With the
  // current Session = root-1, the parent resolves to it (truth table).
  currentSession.ref = {
    sessionId: orch.session.id,
    token: orch.token,
    scope: SCOPE,
  };
  const helper = expectOk(
    await createSession(
      withCreateRunner(base),
      { name: "helper-1", prompt: "do the thing" },
      CTX,
    ),
  );
  const helperToken = launchTokenOf(h.fs, helper.session);

  // 5. messaging as reviewer-1: a message to a sibling and a report to its parent.
  currentSession.ref = {
    sessionId: reviewer.session.id,
    token: reviewer.token,
    scope: SCOPE,
  };
  expectOk(
    await sendMessage(
      base,
      { toSessionId: helper.session.id, body: "ping" },
      CTX,
    ),
  );
  expectOk(await reportParent(base, { body: "progress so far" }, CTX));

  // 6. one message to reviewer-1 so its inbox view is non-empty.
  currentSession.ref = {
    sessionId: orch.session.id,
    token: orch.token,
    scope: SCOPE,
  };
  expectOk(
    await sendMessage(
      base,
      { toSessionId: reviewer.session.id, body: "ack" },
      CTX,
    ),
  );

  currentSession.ref = null;
  return {
    ...h,
    ids: {
      orch: orch.session.id,
      reviewer: reviewer.session.id,
      helper: helper.session.id,
    },
    tokens: {
      orch: orch.token,
      reviewer: reviewer.token,
      helper: helperToken,
    },
  };
}

/** Extract the raw token from a Session's mode-0600 launch script. */
function launchTokenOf(fs: FakeFileSystem, session: Session): string {
  const launch = fs.files.get(
    `${sessionDirFor(SCOPE.worktreeRoot, session.id)}/launch.sh`,
  );
  if (launch === undefined) throw new Error("launch.sh not written");
  const match = launch.contents.match(/AS_SESSION_TOKEN=['"]?([^'"\n]+)/);
  if (match === null) throw new Error("no AS_SESSION_TOKEN in launch.sh");
  return match[1]!;
}

/** Parse the JSON payload an MCP tool result carries in its text content. */
function mcpValue<T>(result: McpToolResult): T {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]!.text) as T;
}

const ALL_TOOL_NAMES = [
  "close_session",
  "create_session",
  "delete_session",
  "get_profile",
  "get_session",
  "init_session",
  "list_messages",
  "list_profiles",
  "list_sessions",
  "peek_session",
  "report_parent",
  "send_message",
];

// --- the smoke flow -------------------------------------------------------

describe("MVP fake-runtime smoke flow", () => {
  test("init → register → create → read → message → report → close → delete", async () => {
    const w = await seedWorld();

    // list/get over the shared store.
    const list = expectOk(await listSessions(w.base, {}, CTX));
    expect(list.sessions.map((s) => s.name).sort()).toEqual([
      "helper-1",
      "reviewer-1",
      "root-1",
    ]);
    const helper = expectOk(
      await getSession(w.base, { id: w.ids.helper }, CTX),
    );
    expect(helper.session.name).toBe("helper-1");
    expectErr(
      await getSession(w.base, { id: "ghost" }, CTX),
      "session_not_found",
    );

    // message-list: full history, self-addressed inbox, and the undelivered view.
    const all = expectOk(await listMessages(w.base, {}, CTX));
    expect(all.messages).toHaveLength(3);
    expect(all.messages.every((m) => m.deliveredAt !== null)).toBe(true);

    w.currentSession.ref = {
      sessionId: w.ids.reviewer,
      token: w.tokens.reviewer,
      scope: SCOPE,
    };
    const inbox = expectOk(
      await listMessages(w.base, { filter: { inbox: true } }, CTX),
    );
    expect(inbox.messages.map((m) => m.body)).toEqual(["ack"]);
    const undelivered = expectOk(
      await listMessages(w.base, { filter: { undelivered: true } }, CTX),
    );
    expect(undelivered.messages).toHaveLength(0);

    // close + delete under operator local trust (no current Session). Delete is
    // destructive store cleanup only after the live Session has been closed.
    w.currentSession.ref = null;
    const helperClosed = expectOk(
      await closeSession(w.base, { id: w.ids.helper }, CTX),
    );
    expect(helperClosed.session.status).toBe("closed");
    const reviewerClosed = expectOk(
      await closeSession(w.base, { id: w.ids.reviewer }, CTX),
    );
    expect(reviewerClosed.session.status).toBe("closed");

    const del = expectOk(
      await deleteSession(w.base, { id: w.ids.reviewer, force: true }, CTX),
    );
    // reviewer-1 is the sender of two Messages and the recipient of one: all go.
    expect(del.deletedMessageCount).toBe(3);
    expect(w.store.sessions.map((s) => s.id).sort()).toEqual(
      [w.ids.orch, w.ids.helper].sort(),
    );
    expect(w.store.messages).toHaveLength(0);
  });

  test("delete refuses without explicit force", async () => {
    const w = await seedWorld();
    expectErr(
      await deleteSession(w.base, { id: w.ids.helper }, CTX),
      "invalid_input",
    );
    expect(w.store.sessions.some((s) => s.id === w.ids.helper)).toBe(true);
  });

  test("token-bearing files are mode 0600 under ignored paths and never reach logs", async () => {
    const w = await seedWorld();

    // init wrote the runtime ignore rules so token/log state never enters Git.
    expect(w.fs.files.get(configPathFor(CWD))).toBeDefined();
    const gitignore = w.fs.files.get(gitignorePathFor(CWD));
    expect(gitignore).toBeDefined();
    for (const rule of RUNTIME_GITIGNORE_RULES) {
      expect(gitignore!.contents).toContain(rule);
    }

    // init-session: the raw token lives only in a mode-0600 file under
    // .asem/tokens/, and the current-session pointer excludes it.
    const tokenPath = tokenFileFor(SCOPE.worktreeRoot, w.ids.orch);
    expect(tokenPath).toContain("/.asem/tokens/");
    const tokenFile = w.fs.files.get(tokenPath);
    expect(tokenFile?.mode).toBe(TOKEN_FILE_MODE);
    expect(tokenFile?.contents).toBe(w.tokens.orch);
    const pointer = w.fs.files.get(currentSessionFileFor(SCOPE.worktreeRoot));
    expect(pointer?.contents).not.toContain(w.tokens.orch);

    // create-session: the token is injected only by the mode-0600 launch script,
    // never the audit prompt.
    const dir = sessionDirFor(SCOPE.worktreeRoot, w.ids.helper);
    const launch = w.fs.files.get(`${dir}/launch.sh`);
    expect(launch?.mode).toBe(TOKEN_FILE_MODE);
    expect(launch!.contents).toContain(w.tokens.helper);
    const prompt = w.fs.files.get(`${dir}/prompt.md`);
    expect(prompt!.contents).not.toContain("AS_SESSION_TOKEN");
    expect(prompt!.contents).not.toContain(w.tokens.helper);

    // Redaction: no raw token ever appears in the shared log stream.
    const logged = JSON.stringify(w.logger.entries);
    expect(logged.length).toBeGreaterThan(0);
    for (const token of [w.tokens.orch, w.tokens.reviewer, w.tokens.helper]) {
      expect(logged).not.toContain(token);
    }
  });
});

describe("MVP smoke — MCP tool projection", () => {
  test("exposes exactly the agreed tools and no attach", () => {
    expect(
      listMcpTools()
        .map((d) => d.name)
        .sort(),
    ).toEqual(ALL_TOOL_NAMES);
    expect(hasMcpTool("create_session")).toBe(true);
    expect(hasMcpTool("attach_session")).toBe(false);
  });

  test("projects shared operations over the same store", async () => {
    const w = await seedWorld();
    // MCP is agent-originated, so give the tool calls a verified current
    // Session. The tools themselves receive no token argument; they rely on the
    // current-session resolver just like an already-running agent would.
    w.currentSession.ref = {
      sessionId: w.ids.reviewer,
      token: w.tokens.reviewer,
      scope: SCOPE,
    };
    const ctx = { cwd: CWD, deps: w.base };

    const listed = mcpValue<{ sessions: Session[] }>(
      await callMcpTool("list_sessions", {}, ctx),
    );
    expect(listed.sessions.map((s) => s.name).sort()).toEqual([
      "helper-1",
      "reviewer-1",
      "root-1",
    ]);

    expect(
      (await callMcpTool("get_session", { id: w.ids.helper }, ctx)).isError,
    ).toBeUndefined();
    expect(
      (await callMcpTool("get_session", { id: "ghost" }, ctx)).isError,
    ).toBe(true);

    const sent = mcpValue<{ message: Message }>(
      await callMcpTool(
        "send_message",
        { toSessionId: w.ids.helper, body: "mcp ping" },
        ctx,
      ),
    );
    expect(sent.message.body).toBe("mcp ping");

    // create_session needs the herdr ref JSON, so give it its own runner.
    const createCtx = { cwd: CWD, deps: withCreateRunner(w.base) };
    const created = mcpValue<{ session: Session }>(
      await callMcpTool(
        "create_session",
        { name: "mcp-child", prompt: "x", root: true },
        createCtx,
      ),
    );
    expect(created.session.name).toBe("mcp-child");
    expect(w.store.sessions.some((s) => s.name === "mcp-child")).toBe(true);

    expect((await callMcpTool("nope", {}, ctx)).isError).toBe(true);
  });
});

describe("MVP smoke — TUI cockpit projection", () => {
  test("renders the cockpit and drives a scripted send over the shared store", async () => {
    const w = await seedWorld();
    const before = w.store.messages.length;
    // s → open send, h, i → draft "hi", Ctrl+Enter → send, q → quit.
    const host = new SmokeHost([
      { key: "s" },
      { key: "h" },
      { key: "i" },
      { key: "return", ctrl: true },
      { key: "q" },
    ]);

    const result = await runCockpit(w.base, host, {
      cwd: CWD,
      scopeMode: "worktree",
    });

    expect(result.ok).toBe(true);
    expect(host.closed).toBe(true);
    expect(host.frames.length).toBeGreaterThan(0);

    // UI basics: the three detail tabs, a quit affordance, and Session rows.
    const frame = host.frames.find((f) => f.left.rows.length > 0)!;
    expect(frame.tabs.map((t) => t.title)).toEqual([
      "Messages",
      "Detail",
      "Context",
    ]);
    expect(frame.keybar.some((k) => k.key === "q")).toBe(true);
    expect(frame.left.rows.some((r) => r.kind === "session")).toBe(true);

    // The scripted send produced a delivered Message in the shared store.
    expect(w.store.messages.length).toBe(before + 1);
    expect(w.store.messages.some((m) => m.body === "hi")).toBe(true);
  });
});

describe("MVP smoke — CLI surface projection", () => {
  test("CLI lists the same Sessions the operations persisted", async () => {
    const w = await seedWorld();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["session", "list"],
      cwd: CWD,
      deps: w.base,
      io,
    });
    expect(code).toBe(EXIT_OK);
    for (const name of ["root-1", "reviewer-1", "helper-1"]) {
      expect(io.outText()).toContain(name);
    }
  });
});
