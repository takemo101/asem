import { describe, expect, test } from "bun:test";
import { hashToken, type ConfigDiscovery } from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { createSession, TOKEN_FILE_MODE } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeFileSystem,
  FakeScopeResolver,
  FakeStore,
  makeOpsDeps,
  MemoryLogger,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
// FakeIdGenerator / FakeTokenGenerator are deterministic: first id/token below.
const FIRST_ID = "s_0001";
const FIRST_TOKEN = "tok_0001";
const SESSION_DIR = `${scopeA.worktreeRoot}/.asem/sessions/${FIRST_ID}`;
const PROMPT_PATH = `${SESSION_DIR}/prompt.md`;
const LAUNCH_PATH = `${SESSION_DIR}/launch.sh`;

/** A runner whose mux `create` step prints a capturable pane id. */
function happyRunner(): FakeTemplateRunner {
  // [0] mux create -> stdout captured as pane_id; later calls default to ok.
  return new FakeTemplateRunner({ commands: [{ stdout: "pane-1" }] });
}

/** Build a deps bundle keeping typed references to the inspectable fakes. */
function deps(
  overrides: {
    runner?: FakeTemplateRunner;
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
  } = {},
) {
  const fs = new FakeFileSystem();
  const logger = new MemoryLogger();
  const runner = overrides.runner ?? happyRunner();
  const store = overrides.store ?? new FakeStore();
  const bundle = makeOpsDeps({
    fs,
    logger,
    store,
    templateRunner: runner,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, fs, logger, runner, store };
}

const ROOT_INPUT = { name: "reviewer-1", prompt: "do the thing", root: true };

describe("createSession — happy path", () => {
  test("runs mux create before run_in_pane and inserts only after a successful start", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // Sequence order: create (capture pane) then run_in_pane.
    expect(d.runner.commands).toHaveLength(2);
    expect(d.runner.commands[0]!.command).toContain("herdr pane split");
    expect(d.runner.commands[1]!.command).toContain("herdr pane send-text");

    // The row is persisted exactly once, after the start.
    expect(d.store.sessions).toHaveLength(1);
    expect(d.store.sessions[0]!.id).toBe(session.id);
    expect(session.id).toBe(FIRST_ID);
    expect(session.status).toBe("running");
  });

  test("creates the Session dir and always writes prompt.md", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    expect(d.fs.dirs.has(SESSION_DIR)).toBe(true);
    expect(session.sessionDir).toBe(SESSION_DIR);

    const prompt = d.fs.files.get(PROMPT_PATH);
    expect(prompt).toBeDefined();
    expect(prompt!.contents).toBe("do the thing\n");
  });

  test("captures mux refs from the create sequence onto the Session", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.muxRef).toEqual({ pane_id: "pane-1" });
  });

  test("writes a mode-0600 launch script injecting env and the agent command", async () => {
    const d = deps();
    expectOk(await createSession(d, ROOT_INPUT, CTX));

    const launch = d.fs.files.get(LAUNCH_PATH);
    expect(launch).toBeDefined();
    expect(launch!.mode).toBe(TOKEN_FILE_MODE);
    expect(TOKEN_FILE_MODE).toBe(0o600);

    const script = launch!.contents;
    expect(script).toContain(`export AS_SESSION_ID='${FIRST_ID}'`);
    expect(script).toContain("export AS_PARENT_SESSION_ID=''");
    expect(script).toContain(`export AS_WORKSPACE_ID='${scopeA.workspaceId}'`);
    expect(script).toContain(`export AS_WORKTREE_ROOT='${scopeA.worktreeRoot}'`);
    expect(script).toContain(`export AS_PROJECT_ROOT='${scopeA.worktreeRoot}'`);
    expect(script).toContain(`export AS_SESSION_TOKEN='${FIRST_TOKEN}'`);
    // Agent (claude, prompt_delivery=arg) reads the prompt file as its argument.
    expect(script).toContain(`claude "$(cat '${PROMPT_PATH}')"`);
  });
});

describe("createSession — parent resolution truth table", () => {
  test("--root creates a root Session with parent_session_id = null", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));
    expect(session.parentSessionId).toBeNull();
  });

  test("--parent <id> uses the explicit parent when it is in scope", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "p_1", name: "parent" }));
    const d = deps({ store });

    const { session } = expectOk(
      await createSession(
        d,
        { name: "child", prompt: "p", parentSessionId: "p_1" },
        CTX,
      ),
    );
    expect(session.parentSessionId).toBe("p_1");
  });

  test("--parent <id> not in scope returns parent_session_not_found", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { name: "child", prompt: "p", parentSessionId: "missing" },
      CTX,
    );
    expectErr(result, "parent_session_not_found");
    expect(d.store.sessions).toHaveLength(0);
  });

  test("no parent flag falls back to the current Session", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "cur_1", name: "current" }));
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: "ignored",
      }),
    });

    const { session } = expectOk(
      await createSession(d, { name: "child", prompt: "p" }, CTX),
    );
    expect(session.parentSessionId).toBe("cur_1");
  });

  test("no parent flag and no current Session returns current_session_not_found", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver(null),
    });
    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "current_session_not_found");
    expect(d.store.sessions).toHaveLength(0);
  });

  test("current Session registered in another scope returns scope_mismatch", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: "ignored",
        scope: scopeB,
      }),
    });
    const result = await createSession(d, { name: "child", prompt: "p" }, CTX);
    expectErr(result, "scope_mismatch");
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — token protection", () => {
  test("keeps the raw token out of the DB, logs, mux refs, and command args", async () => {
    const d = deps();
    const { session } = expectOk(await createSession(d, ROOT_INPUT, CTX));

    // DB stores only the hash.
    expect(session.tokenHash).toBe(hashToken(FIRST_TOKEN));
    expect(session.tokenHash).not.toBe(FIRST_TOKEN);

    // The raw token never appears in logs, mux refs, or issued command strings.
    expect(JSON.stringify(d.logger.entries)).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify(session.muxRef)).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify(d.runner.commands)).not.toContain(FIRST_TOKEN);

    // It lives only in the mode-0600 launch script.
    expect(d.fs.files.get(LAUNCH_PATH)!.contents).toContain(FIRST_TOKEN);
  });
});

describe("createSession — failure leaves no stale row + best-effort cleanup", () => {
  test("a failed mux create returns a structured error with the log path and no row", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "split boom" }],
    });
    const d = deps({ runner });

    const result = await createSession(d, ROOT_INPUT, CTX);
    const error = expectErr(result, "sequence_step_failed");
    expect(error.details?.logPath).toBe(SESSION_DIR);

    // No stale row; prompt.md was written but the launch script was not (the
    // launch script is generated only after a successful create).
    expect(d.store.sessions).toHaveLength(0);
    expect(d.fs.files.has(PROMPT_PATH)).toBe(true);
    expect(d.fs.files.has(LAUNCH_PATH)).toBe(false);
    expect(
      d.logger.entries.some((e) => e.message.includes("mux cleanup")),
    ).toBe(true);
  });

  test("a failed run_in_pane attempts mux close and leaves no row", async () => {
    const runner = new FakeTemplateRunner({
      commands: [
        { stdout: "pane-1" }, // create ok
        { exitCode: 1, stderr: "send boom" }, // run_in_pane fails
        {}, // close ok
      ],
    });
    const d = deps({ runner });

    const result = await createSession(d, ROOT_INPUT, CTX);
    const error = expectErr(result, "sequence_step_failed");
    expect(error.details?.logPath).toBe(SESSION_DIR);

    // Best-effort cleanup ran the mux `close` sequence with the captured pane.
    const closed = d.runner.commands.some((c) =>
      c.command.includes("herdr pane close"),
    );
    expect(closed).toBe(true);

    // No stale Session row.
    expect(d.store.sessions).toHaveLength(0);
  });
});

describe("createSession — template + name validation", () => {
  test("returns mux_template_not_found for an unknown mux", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, mux: "does-not-exist" },
      CTX,
    );
    expectErr(result, "mux_template_not_found");
    // No side effects: the Session dir was never created.
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
  });

  test("returns agent_template_not_found for an unknown agent", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { ...ROOT_INPUT, agent: "does-not-exist" },
      CTX,
    );
    expectErr(result, "agent_template_not_found");
  });

  test("fails fast on a same-scope name collision before any side effects", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "reviewer-1" }));
    const d = deps({ store });

    const result = await createSession(d, ROOT_INPUT, CTX);
    expectErr(result, "session_name_conflict");
    expect(d.runner.commands).toHaveLength(0);
    expect(d.fs.dirs.has(SESSION_DIR)).toBe(false);
  });

  test("rejects invalid input with invalid_input", async () => {
    const d = deps();
    const result = await createSession(
      d,
      { name: "", prompt: "p" } as never,
      CTX,
    );
    expectErr(result, "invalid_input");
  });

  test("returns config_not_found when no .asem.yaml is discovered", async () => {
    const d = deps();
    const result = await createSession(
      {
        ...d,
        configLoader: new FakeConfigLoader({
          kind: "not_found",
        } satisfies ConfigDiscovery),
      },
      ROOT_INPUT,
      CTX,
    );
    expectErr(result, "config_not_found");
  });
});
