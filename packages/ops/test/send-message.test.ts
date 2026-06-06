import { describe, expect, test } from "bun:test";
import { hashToken } from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { formatMessageBody, reportParent, sendMessage } from "../src/index.ts";
import {
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };

/**
 * Build a deps bundle scoped to {@link scopeA}, keeping typed references to the
 * inspectable fakes. A herdr target needs a `pane_id` mux ref for the builtin
 * `send` sequence (`herdr pane send-text {{pane_id_shell}} {{message_shell}}`).
 */
function deps(
  overrides: {
    runner?: FakeTemplateRunner;
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
  } = {},
) {
  const store = overrides.store ?? new FakeStore();
  const runner = overrides.runner ?? new FakeTemplateRunner();
  const logger = new MemoryLogger();
  const bundle = makeOpsDeps({
    store,
    templateRunner: runner,
    logger,
    scopeResolver: new FakeScopeResolver(scopeA),
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
    muxRef: { pane_id: "pane-1", tab_id: "tab-1" },
    ...overrides,
  });
}

const CURRENT_TOKEN = "tok-current";

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

    // Delivered through the herdr `send` sequence using the stored mux ref.
    expect(d.runner.commands).toHaveLength(2);
    expect(d.runner.commands[0]!.command).toContain("herdr pane send-text");
    expect(d.runner.commands[0]!.command).toContain("pane-1");
    expect(d.runner.commands[1]!.command).toContain("herdr pane send-keys");

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

  test("a current Session registered in another scope is rejected", async () => {
    const store = new FakeStore();
    store.sessions.push(makeTarget());
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "cur_x",
        token: "t",
        scope: scopeB,
      }),
    });
    const result = await sendMessage(
      d,
      { toSessionId: "reviewer-1", body: "x" },
      CTX,
    );
    expectErr(result, "scope_mismatch");
  });

  test("cross-worktree target is not found (same-scope sender/target enforced)", async () => {
    const store = new FakeStore();
    // Target lives only in the sibling worktree scopeB; we operate in scopeA.
    store.sessions.push(
      makeTarget({
        id: "t_b",
        workspaceId: scopeB.workspaceId,
        worktreeRoot: scopeB.worktreeRoot,
      }),
    );
    const d = deps({ store });

    const result = await sendMessage(d, { toSessionId: "t_b", body: "x" }, CTX);
    expectErr(result, "session_not_found");
    // No Message is recorded for an out-of-scope target.
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
    // The exact formatted body is what the mux `send` sequence delivered.
    expect(d.runner.commands[0]!.command).toContain("status ok");
    expect(d.store.messages[0]!.formattedBody).toBe(message.formattedBody);
  });

  test("a failed mux send persists delivery_error and keeps the Message", async () => {
    const store = new FakeStore();
    const target = makeTarget();
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "pane gone" }],
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
      commands: [{ exitCode: 1, stderr: `boom ${CURRENT_TOKEN} boom` }],
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
