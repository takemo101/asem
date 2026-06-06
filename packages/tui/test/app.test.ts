import { describe, expect, test } from "bun:test";
import { FakeStore, makeOpsDeps } from "../../ops/src/testing/fakes.ts";
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
}) {
  const env = makeEnv(opts.scopeMode ? { scopeMode: opts.scopeMode } : {});
  const snap: CockpitSnapshot = {
    sessions: [...opts.store.sessions],
    messages: [...opts.store.messages],
  };
  const state = createCockpitState(env, snap);
  const host = new FakeHost();
  const deps = makeOpsDeps({ store: opts.store });
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
      makeSession({ id: "b", name: "b" }),
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

  test("attach leaves to the host and refreshes on return", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app, host } = makeApp({ store });
    await app.dispatch({ type: "attach" });
    expect(host.attaches).toHaveLength(1);
    expect(host.attaches[0]!.session.id).toBe("s1");
  });

  test("a failing operation surfaces the structured error in the status line", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    // Delete the row out from under the app, then confirm a close on it.
    await app.dispatch({ type: "requestClose" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "confirm" });
    expect(result.error?.code).toBe("session_not_found");
    expect(app.view().statusLine).toContain("session_not_found");
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
