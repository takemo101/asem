import { describe, expect, test } from "bun:test";
// The TUI view-model is tested against the shared `@asem/ops` in-memory fakes —
// no real store, multiplexer, or agent (design test matrix: "TUI view-model |
// fake @asem/ops and store snapshots").
import { FakeStore, makeOpsDeps } from "../../ops/src/testing/fakes.ts";
import {
  executeCockpitEffect,
  loadCockpitSnapshot,
  resolveCockpitEnv,
} from "../src/index.ts";
import { expectErr, expectOk, makeMessage, makeSession } from "./helpers.ts";

const CTX = { cwd: "/repo/a" };

describe("loadCockpitSnapshot", () => {
  test("loads scoped Sessions and Messages from fake ops", async () => {
    const store = new FakeStore();
    const s1 = makeSession({ id: "s1", name: "one" });
    const s2 = makeSession({ id: "s2", name: "two" });
    store.sessions.push(s1, s2);
    store.messages.push(makeMessage({ id: "m1", toSessionId: "s1" }));

    const deps = makeOpsDeps({ store });
    const snap = expectOk(await loadCockpitSnapshot(deps, CTX));
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(snap.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  test("default cockpit snapshot loads Sessions across worktree roots in the Workspace", async () => {
    const store = new FakeStore();
    const here = makeSession({ id: "here", worktreeRoot: "/repo/a" });
    const sibling = makeSession({ id: "sibling", worktreeRoot: "/repo/b" });
    store.sessions.push(here, sibling);

    const deps = makeOpsDeps({ store });
    const snap = expectOk(await loadCockpitSnapshot(deps, CTX));
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(["here", "sibling"]);
  });

  test("propagates a structured error from the underlying read", async () => {
    const deps = makeOpsDeps();
    // No config discovered → config_not_found surfaces unchanged.
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const withMissingConfig = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    expectErr(
      await loadCockpitSnapshot(withMissingConfig, CTX),
      "config_not_found",
    );
    // Sanity: the happy-path deps still load fine.
    expectOk(await loadCockpitSnapshot(deps, CTX));
  });

  test("worktree mode filters Sessions and Messages to the current Worktree Root", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "here", worktreeRoot: "/repo/a" }),
      makeSession({ id: "sibling", worktreeRoot: "/repo/b" }),
    );
    store.messages.push(
      makeMessage({ id: "m_here", worktreeRoot: "/repo/a" }),
      makeMessage({ id: "m_sibling", worktreeRoot: "/repo/b" }),
    );
    const deps = makeOpsDeps({ store });
    const snap = expectOk(await loadCockpitSnapshot(deps, CTX, "worktree"));
    expect(snap.sessions.map((s) => s.id)).toEqual(["here"]);
    expect(snap.messages.map((m) => m.id)).toEqual(["m_here"]);
  });

  test("snapshot keeps the explicitly internal unbounded Message read", async () => {
    // The cockpit needs full history, so it reads the internal Workspace
    // snapshot rather than the public paginated list — more Messages than one
    // public page (max 50) still all arrive in a single snapshot.
    const { MESSAGE_PAGE_MAX_LIMIT } = await import("@asem/core");
    const store = new FakeStore();
    const total = MESSAGE_PAGE_MAX_LIMIT + 10;
    for (let i = 0; i < total; i += 1) {
      store.messages.push(makeMessage({ id: `m_bulk_${i}` }));
    }
    const deps = makeOpsDeps({ store });

    const workspaceSnap = expectOk(
      await loadCockpitSnapshot(deps, CTX, "workspace"),
    );
    expect(workspaceSnap.messages).toHaveLength(total);

    const worktreeSnap = expectOk(
      await loadCockpitSnapshot(deps, CTX, "worktree"),
    );
    expect(worktreeSnap.messages).toHaveLength(total);
  });

  test("workspace mode loads Sessions across worktree roots", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "here", worktreeRoot: "/repo/a" }),
      makeSession({
        id: "sibling",
        worktreeRoot: "/repo/b",
        workspaceId: "ws_1",
      }),
    );
    const deps = makeOpsDeps({ store });
    const snap = expectOk(await loadCockpitSnapshot(deps, CTX, "workspace"));
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(["here", "sibling"]);
  });
});

describe("resolveCockpitEnv", () => {
  test("builds the env from the resolved context and config defaults", async () => {
    const deps = makeOpsDeps();
    const env = expectOk(await resolveCockpitEnv(deps, CTX.cwd, "workspace"));
    expect(env.scopeMode).toBe("workspace");
    expect(env.workspaceId).toBe("ws_1");
    expect(env.worktreeRoot).toBe("/repo/a");
    expect(env.defaultMux).toBe("herdr");
    expect(env.defaultAgent).toBe("claude");
  });

  test("surfaces config errors unchanged", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    expectErr(
      await resolveCockpitEnv(deps, CTX.cwd, "worktree"),
      "config_not_found",
    );
  });
});

describe("executeCockpitEffect", () => {
  test("send dispatches send_message to fake ops", async () => {
    const store = new FakeStore();
    const target = makeSession({ id: "t1" });
    store.sessions.push(target);

    const deps = makeOpsDeps({ store });
    const outcome = expectOk(
      await executeCockpitEffect(deps, CTX, {
        kind: "send",
        sessionId: "t1",
        body: "hi",
      }),
    );
    expect(outcome.kind).toBe("sent");
    if (outcome.kind === "sent") {
      expect(outcome.message.toSessionId).toBe("t1");
      expect(outcome.message.body).toBe("hi");
    }
    // The Message was actually recorded in the store.
    expect(store.messages).toHaveLength(1);
  });

  test("close dispatches close_session and marks the Session closed", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "c1", status: "running" }));

    const deps = makeOpsDeps({ store });
    const outcome = expectOk(
      await executeCockpitEffect(deps, CTX, { kind: "close", sessionId: "c1" }),
    );
    expect(outcome.kind).toBe("closed");
    if (outcome.kind === "closed") {
      expect(outcome.session.status).toBe("closed");
    }
  });

  test("delete dispatches delete_session with force and removes the Session", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "d1", status: "closed" }));
    store.messages.push(makeMessage({ id: "m1", toSessionId: "d1" }));

    const deps = makeOpsDeps({ store });
    const outcome = expectOk(
      await executeCockpitEffect(deps, CTX, {
        kind: "delete",
        sessionId: "d1",
      }),
    );
    expect(outcome.kind).toBe("deleted");
    if (outcome.kind === "deleted") {
      expect(outcome.deletedSessionId).toBe("d1");
      expect(outcome.deletedMessageCount).toBe(1);
    }
    expect(store.sessions).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
  });

  test("refresh reloads a snapshot via fake ops", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "r1" }));

    const deps = makeOpsDeps({ store });
    const outcome = expectOk(
      await executeCockpitEffect(deps, CTX, { kind: "refresh" }),
    );
    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind === "refreshed") {
      expect(outcome.snapshot.sessions.map((s) => s.id)).toEqual(["r1"]);
    }
  });

  test("attach and quit are host-local and reach no operation", async () => {
    const deps = makeOpsDeps();
    const attach = expectOk(
      await executeCockpitEffect(deps, CTX, {
        kind: "attach",
        sessionId: "s1",
      }),
    );
    expect(attach).toEqual({ kind: "attach", sessionId: "s1" });
    const quit = expectOk(
      await executeCockpitEffect(deps, CTX, { kind: "quit" }),
    );
    expect(quit).toEqual({ kind: "quit" });
  });

  test("a failed operation surfaces its structured error", async () => {
    const store = new FakeStore();
    const deps = makeOpsDeps({ store });
    // No such Session in scope → close_session returns session_not_found.
    expectErr(
      await executeCockpitEffect(deps, CTX, {
        kind: "close",
        sessionId: "ghost",
      }),
      "session_not_found",
    );
  });
});
