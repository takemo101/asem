import { describe, expect, test } from "bun:test";
import { hashToken } from "@asem/core";
import {
  FakeCurrentSessionResolver,
  FakeStore,
  MemoryLogger,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import type { CockpitSnapshot } from "../src/index.ts";
import { CockpitApp, createCockpitState, runCockpit } from "../src/index.ts";
import {
  FakeHost,
  makeEnv,
  type makeMessage,
  makeSession,
  WORKTREE_A,
  WORKTREE_B,
} from "./helpers.ts";

function snapshot(
  sessions: ReturnType<typeof makeSession>[],
  messages: ReturnType<typeof makeMessage>[] = [],
): CockpitSnapshot {
  return { sessions, messages };
}

function makeApp(opts: {
  store: FakeStore;
  scopeMode?: "worktree" | "workspace";
  currentSessionResolver?: FakeCurrentSessionResolver;
}) {
  const env = makeEnv(opts.scopeMode ? { scopeMode: opts.scopeMode } : {});
  const snap: CockpitSnapshot = {
    sessions: [...opts.store.sessions],
    messages: [...opts.store.messages],
  };
  const state = createCockpitState(env, snap);
  const host = new FakeHost();
  const deps = makeOpsDeps({
    store: opts.store,
    ...(opts.currentSessionResolver
      ? { currentSessionResolver: opts.currentSessionResolver }
      : {}),
  });
  return { app: new CockpitApp(deps, env, state, host), host, deps };
}

describe("CockpitApp effects", () => {
  test("send dispatches send_message and refreshes", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app } = makeApp({ store });

    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "ping" });
    const result = await app.dispatch({ type: "submitSend" });

    expect(result.error).toBeUndefined();
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.body).toBe("ping");
    // The refreshed snapshot now carries the new Message.
    expect(app.state.snapshot.messages.map((m) => m.body)).toEqual(["ping"]);
  });

  test("confirmed delete removes the Session and reselects", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", name: "a" }),
      makeSession({ id: "b", name: "b", status: "closed" }),
    );
    const { app } = makeApp({ store });

    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "requestDelete" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions.map((s) => s.id)).toEqual(["a"]);
    // 'b' is gone, so selection falls back to the remaining Session.
    expect(app.state.selectedSessionId).toBe("a");
  });

  test("close dispatches close_session", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", status: "running" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestClose" });
    await app.dispatch({ type: "confirm" });
    expect(store.sessions[0]!.status).toBe("closed");
  });

  test("close uses the provided deps logger; surface composition supplies the TUI-safe logger", async () => {
    const store = new FakeStore();
    const logger = new MemoryLogger();
    store.sessions.push(makeSession({ id: "s1", status: "running" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const app = new CockpitApp(
      makeOpsDeps({ store, logger }),
      env,
      state,
      new FakeHost(),
    );

    await app.dispatch({ type: "requestClose" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions[0]!.status).toBe("closed");
    expect(
      logger.entries.some((entry) => entry.message === "closed Session"),
    ).toBe(true);
  });

  test("attach leaves to the host with the get_session hint and refreshes", async () => {
    const store = new FakeStore();
    // The default muxRef carries herdr session/workspace/tab refs, so attach
    // can be represented as structured argv instead of a shell-only hint.
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app, host } = makeApp({ store });
    await app.dispatch({ type: "attach" });
    expect(host.attaches).toHaveLength(1);
    expect(host.attaches[0]!.session.id).toBe("s1");
    expect(host.attaches[0]!.attachHint).toContain("herdr --session 'asem'");
    expect(host.attaches[0]!.attachCommand).toEqual({
      argv: [
        "sh",
        "-c",
        "herdr --session 'asem' workspace focus 'ws_1' >/dev/null && herdr --session 'asem' tab focus 'tab-1' >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
      ],
    });
  });

  test("attach on a closed Session opens an error modal and does not call the host", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "s1", name: "one", status: "closed" }),
    );
    const { app, host } = makeApp({ store });

    const result = await app.dispatch({ type: "attach" });

    expect(result.effect).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(host.attaches).toEqual([]);
    expect(app.state.modal).toEqual({
      kind: "error",
      code: "session_closed",
      message: "closed Sessions cannot be attached",
    });
  });

  test("attach passes a null hint when the mux ref cannot render one", async () => {
    const store = new FakeStore();
    // herdr's attach references session/workspace/tab refs, which this ref lacks → no hint.
    store.sessions.push(
      makeSession({ id: "s1", name: "one", muxRef: { tab_id: "tab-1" } }),
    );
    const { app, host } = makeApp({ store });
    await app.dispatch({ type: "attach" });
    expect(host.attaches).toHaveLength(1);
    expect(host.attaches[0]!.attachHint).toBeNull();
    expect(host.attaches[0]!.attachCommand).toBeNull();
  });

  test("a failing close opens the error modal instead of the status line", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    // Delete the row out from under the app, then confirm a close on it.
    await app.dispatch({ type: "requestClose" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "confirm" });
    expect(result.error?.code).toBe("session_not_found");
    const view = app.view();
    expect(view.modal?.kind).toBe("error");
    expect(view.modal?.title).toBe("Operation failed");
    expect(view.modal?.lines.join("\n")).toContain("session_not_found");
    expect(view.statusLine).toBeNull();
  });

  test("a failing delete opens the error modal", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestDelete" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "confirm" });
    expect(result.error?.code).toBe("session_not_found");
    expect(app.state.modal.kind).toBe("error");
    expect(app.view().statusLine).toBeNull();
  });

  test("a failing send opens the error modal", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "ping" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "submitSend" });
    expect(result.error?.code).toBe("session_not_found");
    expect(app.state.modal.kind).toBe("error");
    expect(app.view().statusLine).toBeNull();
  });

  test("dismissing the error modal returns to the normal cockpit", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestClose" });
    store.sessions.length = 0;
    await app.dispatch({ type: "confirm" });
    expect(app.state.modal.kind).toBe("error");
    // q dismisses the modal instead of quitting.
    await app.handleKey({ key: "q" });
    expect(app.state.modal.kind).toBe("none");
    expect(app.quit).toBe(false);
  });

  test("an operation error while a modal is open falls back to the status line", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "keep" });
    app.reportOperationError({ code: "timeout", message: "boom" });
    // The draft survives; the error degrades to the status line.
    expect(app.state.modal).toEqual({ kind: "send", draft: "keep" });
    expect(app.view().statusLine).toBe("error: timeout: boom");
  });

  test("a manual refresh error stays in the status line without a modal", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const app = new CockpitApp(deps, env, state, new FakeHost());
    const result = await app.dispatch({ type: "refresh" });
    expect(result.error?.code).toBe("config_not_found");
    expect(app.state.modal.kind).toBe("none");
    expect(app.view().modal).toBeNull();
    expect(app.view().statusLine).toContain("config_not_found");
  });

  test("an auto-refresh tick error stays in the status line without a modal", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const host = new FakeHost(["tick", null]);
    const app = new CockpitApp(deps, env, state, host);
    await app.run();
    // The tick error never opens a modal — it would reopen every interval.
    const last = host.lastFrame();
    expect(last?.modal).toBeNull();
    expect(last?.statusLine).toContain("config_not_found");
  });
});

describe("CockpitApp workspace scope", () => {
  test("operates on a Session in a sibling worktree using its own scope", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", worktreeRoot: WORKTREE_A }),
      makeSession({ id: "b", name: "b", worktreeRoot: WORKTREE_B }),
    );
    const { app } = makeApp({ store, scopeMode: "workspace" });

    // Select the sibling-worktree Session and send to it.
    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "cross" });
    const result = await app.dispatch({ type: "submitSend" });

    expect(result.error).toBeUndefined();
    const delivered = store.messages.find((m) => m.toSessionId === "b");
    expect(delivered?.body).toBe("cross");
    expect(delivered?.worktreeRoot).toBe(WORKTREE_B);
  });

  test("send to a sibling worktree does not impersonate that worktree's current Session", async () => {
    // The sibling worktree B has its own current-Session pointer (an agent
    // registered there). A workspace-scope TUI send runs with `cwd` set to B's
    // root, so a naive resolve would adopt B's current Session as the sender.
    // The operator send must instead be recorded with no source attribution
    // (MIK-022 / ADR 0003): the human is not that agent.
    const token = "tok-b-agent";
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", worktreeRoot: WORKTREE_A }),
      makeSession({ id: "b", name: "b", worktreeRoot: WORKTREE_B }),
      makeSession({
        id: "b-agent",
        name: "b-agent",
        worktreeRoot: WORKTREE_B,
        tokenHash: hashToken(token),
      }),
    );
    // B's current-Session pointer resolves to its own registered agent.
    const currentSessionResolver = new FakeCurrentSessionResolver({
      sessionId: "b-agent",
      token,
    });
    const { app } = makeApp({
      store,
      scopeMode: "workspace",
      currentSessionResolver,
    });

    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "operator note" });
    const result = await app.dispatch({ type: "submitSend" });

    expect(result.error).toBeUndefined();
    const delivered = store.messages.find((m) => m.toSessionId === "b");
    expect(delivered?.body).toBe("operator note");
    expect(delivered?.worktreeRoot).toBe(WORKTREE_B);
    // The crux: operator-originated, not attributed to B's current Session.
    expect(delivered?.fromSessionId).toBeNull();
    expect(delivered?.formattedBody).toBe("[asem message]\noperator note");
  });

  test("close ignores a stale current-Session pointer because it is an operator action", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", worktreeRoot: WORKTREE_A }),
      makeSession({ id: "b", name: "b", worktreeRoot: WORKTREE_B }),
    );
    const currentSessionResolver = new FakeCurrentSessionResolver({
      sessionId: "missing-current",
      token: "stale-token",
    });
    const { app } = makeApp({
      store,
      scopeMode: "workspace",
      currentSessionResolver,
    });

    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "requestClose" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions.find((s) => s.id === "b")?.status).toBe("closed");
  });

  test("delete ignores a stale current-Session pointer because it is an operator action", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", worktreeRoot: WORKTREE_A }),
      makeSession({
        id: "b",
        name: "b",
        status: "closed",
        worktreeRoot: WORKTREE_B,
      }),
    );
    const currentSessionResolver = new FakeCurrentSessionResolver({
      sessionId: "missing-current",
      token: "stale-token",
    });
    const { app } = makeApp({
      store,
      scopeMode: "workspace",
      currentSessionResolver,
    });

    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "requestDelete" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("run loop", () => {
  test("draws frames, processes a scripted send, and quits", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const host = new FakeHost([
      { key: "s" },
      { key: "h" },
      { key: "i" },
      { key: "return", ctrl: true },
      { key: "q" },
    ]);
    const app = new CockpitApp(makeOpsDeps({ store }), env, state, host);

    await app.run();

    expect(app.quit).toBe(true);
    expect(host.closed).toBe(true);
    expect(host.frames.length).toBeGreaterThan(0);
    expect(store.messages.map((m) => m.body)).toEqual(["hi"]);
  });

  test("EOF (null key) ends the loop", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const host = new FakeHost([]); // immediately exhausted → null
    const app = new CockpitApp(makeOpsDeps({ store }), env, state, host);
    await app.run();
    expect(host.closed).toBe(true);
  });
});

describe("runCockpit", () => {
  test("resolves env + snapshot, runs, and returns ok", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const host = new FakeHost([{ key: "q" }]);
    const result = await runCockpit(makeOpsDeps({ store }), host, {
      cwd: WORKTREE_A,
      scopeMode: "worktree",
    });
    expect(result.ok).toBe(true);
    expect(host.closed).toBe(true);
  });

  test("propagates a config error without starting the loop", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const host = new FakeHost([{ key: "q" }]);
    const result = await runCockpit(deps, host, {
      cwd: WORKTREE_A,
      scopeMode: "worktree",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("config_not_found");
    // The loop never started, so the host was never driven.
    expect(host.frames).toHaveLength(0);
  });
});
