import { describe, expect, test } from "bun:test";
import {
  type ConfigDiscovery,
  hashToken,
  type ScopeResolver,
} from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { formatMessageBody, reportParent, sendMessage } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const HERDR_REF = {
  pane_id: "pane-1",
  tab_id: "tab-1",
  herdr_workspace_id: "herdr-workspace-1",
  herdr_session: "asem",
};

/**
 * Build a deps bundle scoped to {@link scopeA}, keeping typed references to the
 * inspectable fakes. A herdr target carries the owning herdr session and pane
 * refs captured at create time.
 */
function deps(
  overrides: {
    runner?: FakeTemplateRunner;
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
    scopeResolver?: ScopeResolver;
  } = {},
) {
  const store = overrides.store ?? new FakeStore();
  const runner = overrides.runner ?? new FakeTemplateRunner();
  const logger = new MemoryLogger();
  const bundle = makeOpsDeps({
    store,
    templateRunner: runner,
    logger,
    scopeResolver: overrides.scopeResolver ?? new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, store, runner, logger };
}

/** A deliverable herdr target (its `send` sequence resolves `pane_id`). */
function makeTarget(overrides = {}) {
  return makeSession({
    name: "reviewer-1",
    mux: "herdr",
    muxRef: HERDR_REF,
    ...overrides,
  });
}

const CURRENT_TOKEN = "tok-current";
const scopeC = { ...scopeB, workspaceId: "ws_2" };

function workspaceScopeByCwd(
  worktreeByCwd: Record<string, string>,
): ScopeResolver {
  return {
    async resolve(cwd, config) {
      return {
        workspaceId: config.workspace.id,
        worktreeRoot: worktreeByCwd[cwd] ?? cwd,
      };
    },
    async resolveWorktreeRoot(cwd) {
      return worktreeByCwd[cwd] ?? cwd;
    },
  };
}

/** Seed a current Session that authenticates with {@link CURRENT_TOKEN}. */
function seedCurrent(store: FakeStore, overrides = {}) {
  const me = makeSession({
    id: "cur_1",
    name: "helper-1",
    tokenHash: hashToken(CURRENT_TOKEN),
    ...overrides,
  });
  store.sessions.push(me);
  return me;
}

describe("sendMessage — same-worktree delivery", () => {
  test("human (no current Session) records and delivers into the target pane", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    store.sessions.push(target);
    const d = deps({ store });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "ping" }, CTX),
    );

    // Recorded truthfully with both body and the exact formatted body.
    expect(d.store.messages).toHaveLength(1);
    expect(d.store.messages[0]!.body).toBe("ping");
    expect(message.fromSessionId).toBeNull();
    expect(message.kind).toBe("message");

    // Delivered through the herdr `send` sequence: wait for idle, then inject.
    expect(d.runner.commands).toHaveLength(2);
    expect(d.runner.commands[0]!.command).toContain(
      "herdr --session 'asem' wait agent-status 'pane-1' --status idle",
    );
    expect(d.runner.commands[1]!.command).toContain(
      "herdr --session 'asem' pane run 'pane-1'",
    );
    expect(d.runner.commands[1]!.command).toContain("ping");

    // Success sets delivered_at and leaves no delivery_error (no fabricated ack).
    expect(message.deliveredAt).not.toBeNull();
    expect(message.deliveryError).toBeNull();
    expect(d.store.messages[0]!.deliveredAt).toBe(message.deliveredAt);
  });

  test("agent-originated send verifies the current Session and attributes it", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    const me = seedCurrent(store);
    store.sessions.push(target);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "from agent" }, CTX),
    );
    expect(message.fromSessionId).toBe(me.id);
    expect(message.deliveredAt).not.toBeNull();
  });

  test("operator origin sends with no attribution even when a current Session resolves", async () => {
    // The resolved worktree has its own current-Session pointer (an agent), but
    // an operator surface (TUI) must not adopt it: `ctx.origin === "operator"`
    // forces the human local-trust path, recording the Message with no source
    // attribution rather than silently impersonating that Session (MIK-022).
    const store = new FakeStore();
    const target = makeTarget();
    const me = seedCurrent(store);
    store.sessions.push(target);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { message } = expectOk(
      await sendMessage(
        d,
        { toSessionId: target.id, body: "from operator" },
        { ...CTX, origin: "operator" },
      ),
    );
    // Recorded operator-originated: no impersonation of the current Session.
    expect(message.fromSessionId).toBeNull();
    expect(message.formattedBody).toBe("[asem message]\nfrom operator");
    expect(d.store.messages[0]!.fromSessionId).toBeNull();
    expect(message.deliveredAt).not.toBeNull();
  });
});

describe("sendMessage — auth & scope", () => {
  test("an invalid current-Session token is rejected", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    const me = seedCurrent(store);
    store.sessions.push(target);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: "wrong-token",
      }),
    });

    const result = await sendMessage(
      d,
      { toSessionId: target.id, body: "x" },
      CTX,
    );
    expectErr(result, "invalid_session_token");
    expect(d.store.messages).toHaveLength(0);
  });

  test("a current Session registered in another Workspace is rejected", async () => {
    const store = new FakeStore();
    store.sessions.push(makeTarget());
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_x",
        token: "t",
        scope: scopeC,
      }),
    });
    const result = await sendMessage(
      d,
      { toSessionId: "reviewer-1", body: "x" },
      CTX,
    );
    expectErr(result, "scope_mismatch");
  });

  test("can target a Session in another Worktree Root within the same Workspace", async () => {
    const store = new FakeStore();
    const target = makeTarget({
      id: "t_b",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
      cwd: scopeB.worktreeRoot,
    });
    store.sessions.push(target);
    const d = deps({ store });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: "t_b", body: "x" }, CTX),
    );

    expect(message.toSessionId).toBe("t_b");
    expect(message.worktreeRoot).toBe(scopeB.worktreeRoot);
    expect(d.store.messages[0]!.worktreeRoot).toBe(scopeB.worktreeRoot);
    expect(d.runner.commands).toHaveLength(2);
  });

  test("target in another Workspace is not found", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeTarget({
        id: "t_c",
        workspaceId: scopeC.workspaceId,
        worktreeRoot: scopeC.worktreeRoot,
      }),
    );
    const d = deps({ store });

    const result = await sendMessage(d, { toSessionId: "t_c", body: "x" }, CTX);
    expectErr(result, "session_not_found");
    expect(d.store.messages).toHaveLength(0);
  });
});

describe("sendMessage — formatted body & delivery failure", () => {
  test("formatted_body carries the message header and the exact sent text", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    const me = seedCurrent(store);
    store.sessions.push(target);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "status ok" }, CTX),
    );
    expect(message.formattedBody).toBe(
      `[asem message from helper-1 (cur_1)]\nstatus ok`,
    );
    // The exact formatted body is what the mux `send` sequence injected.
    expect(d.runner.commands[1]!.command).toContain("status ok");
    expect(d.store.messages[0]!.formattedBody).toBe(message.formattedBody);
  });

  test("a failed mux send persists delivery_error and keeps the Message", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{}, { exitCode: 1, stderr: "pane gone" }],
    });
    const d = deps({ store, runner });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "ping" }, CTX),
    );

    // The operation still succeeds; truthful history records the failure.
    expect(message.deliveredAt).toBeNull();
    expect(message.deliveryError).not.toBeNull();
    expect(message.deliveryError).toContain("sequence_step_failed");
    expect(d.store.messages).toHaveLength(1);
    expect(d.store.messages[0]!.deliveryError).toBe(message.deliveryError);
  });

  test("an unknown target mux template is a delivery_error, not a thrown defect", async () => {
    const store = new FakeStore();
    const target = makeTarget({ mux: "does-not-exist" });
    store.sessions.push(target);
    const d = deps({ store });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "x" }, CTX),
    );
    expect(message.deliveredAt).toBeNull();
    expect(message.deliveryError).toContain("mux template not found");
  });

  test("a stored mux: none target records an actionable delivery_error and still persists the Message", async () => {
    const store = new FakeStore();
    const target = makeTarget({ mux: "none" });
    store.sessions.push(target);
    const d = deps({ store });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "ping" }, CTX),
    );

    // Durability is preserved: the Message is recorded even though the target
    // has no live delivery Multiplexer.
    expect(d.store.messages).toHaveLength(1);
    expect(message.deliveredAt).toBeNull();

    // The delivery error is actionable, not the bare internal template lookup
    // failure, and points at re-registering with a deliverable mux (MIK-049).
    expect(message.deliveryError).not.toBe("mux template not found: none");
    expect(message.deliveryError).toContain("no live delivery Multiplexer");
    expect(message.deliveryError?.toLowerCase()).toContain("herdr");
  });

  test("a malformed target mux template returns invalid_template and records no Message", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    store.sessions.push(target);
    const config = makeConfig({
      mux: {
        default: "herdr",
        templates: { herdr: { send: [{ type: "unknown_step" }] } },
      },
    });
    const d = {
      ...deps({ store }),
      configLoader: new FakeConfigLoader({
        kind: "found",
        config,
        configPath: "/repo/.asem.yaml",
      } satisfies ConfigDiscovery),
    };

    // A malformed project-local template is a config defect surfaced before the
    // Message is recorded (no side effect), consistent with create/close/get —
    // unlike a *missing* template, which is a best-effort delivery_error.
    const error = expectErr(
      await sendMessage(d, { toSessionId: target.id, body: "x" }, CTX),
      "invalid_template",
    );
    expect(error.details?.kind).toBe("mux");
    expect(error.details?.name).toBe("herdr");
    expect(d.store.messages).toHaveLength(0);
  });
});

describe("sendMessage — token redaction", () => {
  test("the sender's raw token never appears in the Message, logs, commands, or delivery_error", async () => {
    const store = new FakeStore();
    // The target's mux ref echoes the token into the send command + failure
    // stderr, so redaction has something concrete to mask.
    const target = makeTarget();
    const me = seedCurrent(store);
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{}, { exitCode: 1, stderr: `boom ${CURRENT_TOKEN} boom` }],
    });
    const d = deps({
      store,
      runner,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { message } = expectOk(
      await sendMessage(d, { toSessionId: target.id, body: "ping" }, CTX),
    );

    expect(message.deliveryError).not.toContain(CURRENT_TOKEN);
    expect(JSON.stringify(message)).not.toContain(CURRENT_TOKEN);
    expect(JSON.stringify(d.store.messages)).not.toContain(CURRENT_TOKEN);
    expect(JSON.stringify(d.logger.entries)).not.toContain(CURRENT_TOKEN);
  });
});

describe("reportParent", () => {
  test("delivers a report to the resolved parent Session", async () => {
    const store = new FakeStore();
    const parent = makeTarget({ id: "p_1", name: "parent" });
    const me = seedCurrent(store, { parentSessionId: "p_1" });
    store.sessions.push(parent);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { message } = expectOk(
      await reportParent(d, { body: "halfway done" }, CTX),
    );
    expect(message.kind).toBe("report");
    expect(message.fromSessionId).toBe(me.id);
    expect(message.toSessionId).toBe("p_1");
    expect(message.formattedBody).toBe(
      `[asem report from helper-1 (cur_1)]\nhalfway done`,
    );
    expect(message.deliveredAt).not.toBeNull();
  });

  test("repo child can report to a parent in another Worktree Root within the same Workspace", async () => {
    const store = new FakeStore();
    const parent = makeTarget({
      id: "p_a",
      name: "workspace-parent",
      worktreeRoot: scopeA.worktreeRoot,
      cwd: scopeA.worktreeRoot,
    });
    const me = seedCurrent(store, {
      id: "cur_b",
      name: "repo-child",
      parentSessionId: "p_a",
      worktreeRoot: scopeB.worktreeRoot,
      cwd: scopeB.worktreeRoot,
      sessionDir: `${scopeB.worktreeRoot}/.asem/sessions/cur_b`,
    });
    store.sessions.push(parent);
    const d = deps({
      store,
      scopeResolver: workspaceScopeByCwd({
        [scopeA.worktreeRoot]: scopeA.worktreeRoot,
        [scopeB.worktreeRoot]: scopeB.worktreeRoot,
      }),
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
        scope: scopeB,
      }),
    });

    const { message } = expectOk(
      await reportParent(
        d,
        { body: "repo report" },
        { cwd: scopeB.worktreeRoot },
      ),
    );

    expect(message.kind).toBe("report");
    expect(message.fromSessionId).toBe("cur_b");
    expect(message.toSessionId).toBe("p_a");
    expect(message.worktreeRoot).toBe(scopeA.worktreeRoot);
    expect(message.deliveredAt).not.toBeNull();
  });

  test("fails clearly when the current Session has no parent", async () => {
    const store = new FakeStore();
    const me = seedCurrent(store, { parentSessionId: null });
    void me;
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: CURRENT_TOKEN,
      }),
    });

    const result = await reportParent(d, { body: "x" }, CTX);
    expectErr(result, "parent_session_not_found");
    expect(d.store.messages).toHaveLength(0);
  });

  test("fails when the parent is not in scope", async () => {
    const store = new FakeStore();
    seedCurrent(store, { parentSessionId: "ghost" });
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_1",
        token: CURRENT_TOKEN,
      }),
    });

    const result = await reportParent(d, { body: "x" }, CTX);
    expectErr(result, "parent_session_not_found");
  });

  test("requires a current Session", async () => {
    const d = deps({
      currentSessionResolver: new FakeCurrentSessionResolver(null),
    });
    const result = await reportParent(d, { body: "x" }, CTX);
    expectErr(result, "current_session_not_found");
  });
});

describe("formatMessageBody", () => {
  test("identifies message vs report and names the source Session", () => {
    expect(
      formatMessageBody("message", { name: "reviewer-1", id: "s_1" }, "hi"),
    ).toBe("[asem message from reviewer-1 (s_1)]\nhi");
    expect(
      formatMessageBody("report", { name: "reviewer-1", id: "s_1" }, "done"),
    ).toBe("[asem report from reviewer-1 (s_1)]\ndone");
  });

  test("omits the source clause for a human-originated Message", () => {
    expect(formatMessageBody("message", null, "hi")).toBe("[asem message]\nhi");
  });
});
