import { describe, expect, test } from "bun:test";
import { FakeStore, makeOpsDeps } from "../../ops/src/testing/fakes.ts";
import { CockpitApp, createCockpitState, runCockpit } from "../src/index.ts";
import { snapshot } from "./app-helpers.ts";
import { FakeHost, makeEnv, makeSession, WORKTREE_A } from "./helpers.ts";

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
