import { describe, expect, test } from "bun:test";
import { FakeStore, makeOpsDeps } from "../../ops/src/testing/fakes.ts";
import type { CockpitSnapshot } from "../src/index.ts";
import {
  AUTO_REFRESH_MS,
  CockpitApp,
  createCockpitState,
} from "../src/index.ts";
import { FakeHost, makeEnv, makeSession } from "./helpers.ts";

function makeApp(opts: {
  store: FakeStore;
  host: FakeHost;
  autoRefreshMs?: number;
}) {
  const env = makeEnv();
  const snap: CockpitSnapshot = {
    sessions: [...opts.store.sessions],
    messages: [...opts.store.messages],
  };
  const state = createCockpitState(env, snap);
  const deps = makeOpsDeps({ store: opts.store });
  return new CockpitApp(
    deps,
    env,
    state,
    opts.host,
    opts.autoRefreshMs !== undefined
      ? { autoRefreshMs: opts.autoRefreshMs }
      : {},
  );
}

describe("cockpit auto-refresh", () => {
  test("a tick refreshes the snapshot and produces activity", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "parent" }));
    const host = new FakeHost(["tick", null]);
    const app = makeApp({ store, host });

    // A Session appears externally between the initial snapshot and the tick.
    store.sessions.push(makeSession({ id: "s2", name: "helper-2" }));
    await app.run();

    expect(app.state.snapshot.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(app.state.activity).toHaveLength(1);
    expect(app.state.activity[0]).toMatchObject({
      kind: "session_added",
      sessionId: "s2",
    });
    // The idle read carried the default 3s auto-refresh timeout.
    expect(host.reads[0]).toEqual({
      method: "nextKeyOrTick",
      timeoutMs: AUTO_REFRESH_MS,
    });
    expect(host.closed).toBe(true);
  });

  test("an open modal pauses auto-refresh (plain key reads only)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    // Open help, then read one more key while the modal is open, then EOF.
    const host = new FakeHost([{ key: "?" }, { key: "?" }, null]);
    const app = makeApp({ store, host });

    await app.run();

    // Idle reads use the tick-capable seam; the modal read does not.
    expect(host.reads.map((r) => r.method)).toEqual([
      "nextKeyOrTick", // idle: "?" opens help
      "nextKey", // help modal open: auto-refresh paused
      "nextKeyOrTick", // help closed again: idle
    ]);
  });

  test("a tick while a modal is scripted behind it never reaches nextKey", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    // "s" opens the send modal; the FakeHost throws if the app pulls the tick
    // through nextKey, so finishing the run proves the pause ordering: the
    // tick is consumed only after Esc closes the modal.
    const host = new FakeHost([{ key: "s" }, { key: "escape" }, "tick", null]);
    const app = makeApp({ store, host });

    await app.run();

    expect(host.reads.map((r) => r.method)).toEqual([
      "nextKeyOrTick",
      "nextKey",
      "nextKeyOrTick",
      "nextKeyOrTick",
    ]);
  });

  test("a custom interval is passed through to the host", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const host = new FakeHost([null]);
    const app = makeApp({ store, host, autoRefreshMs: 50 });
    await app.run();
    expect(host.reads[0]).toEqual({ method: "nextKeyOrTick", timeoutMs: 50 });
  });

  test("a host without nextKeyOrTick still runs (no auto-refresh)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const host = new FakeHost([{ key: "q" }]);
    // Simulate a minimal host lacking the optional seam.
    (host as { nextKeyOrTick?: unknown }).nextKeyOrTick = undefined;
    const app = makeApp({ store, host });
    await app.run();
    expect(host.reads.map((r) => r.method)).toEqual(["nextKey"]);
    expect(app.quit).toBe(true);
  });
});
