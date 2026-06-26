import { describe, expect, test } from "bun:test";
import { listSessions } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeLivenessProbe,
  FakeScopeResolver,
  FakeStore,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };

function depsWith(store: FakeStore, overrides = {}) {
  return makeOpsDeps({
    store,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...overrides,
  });
}

describe("listSessions", () => {
  test("returns all Sessions in the Workspace by default", async () => {
    const store = new FakeStore();
    const a1 = makeSession({ name: "a1" });
    const a2 = makeSession({ name: "a2" });
    const b1 = makeSession({
      name: "b1",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
    });
    store.sessions.push(a1, a2, b1);

    const { sessions } = expectOk(
      await listSessions(depsWith(store), { filter: undefined }, CTX),
    );
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual([a1.id, a2.id, b1.id].sort());
  });

  test("passes a worktreeRoot filter through to the Workspace query", async () => {
    const store = new FakeStore();
    const here = makeSession({
      name: "here",
      worktreeRoot: scopeA.worktreeRoot,
    });
    const there = makeSession({
      name: "there",
      worktreeRoot: scopeB.worktreeRoot,
    });
    store.sessions.push(here, there);

    const { sessions } = expectOk(
      await listSessions(
        depsWith(store),
        { filter: { worktreeRoot: scopeA.worktreeRoot } },
        CTX,
      ),
    );
    expect(sessions.map((s) => s.id)).toEqual([here.id]);
  });

  test("passes a status filter through to the scoped query", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ name: "run", status: "running" }),
      makeSession({ name: "done", status: "closed" }),
    );

    const { sessions } = expectOk(
      await listSessions(
        depsWith(store),
        { filter: { status: "closed" } },
        CTX,
      ),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.status).toBe("closed");
  });

  test("does not run a liveness pass unless asked", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ status: "running" }));
    const probe = new FakeLivenessProbe();

    expectOk(
      await listSessions(
        depsWith(store, { livenessProbe: probe }),
        { filter: undefined },
        CTX,
      ),
    );
    expect(probe.probed).toHaveLength(0);
  });

  test("refreshLiveness updates only probeable Sessions and records process state", async () => {
    const store = new FakeStore();
    const running = makeSession({ name: "run", status: "running" });
    const closed = makeSession({ name: "done", status: "closed" });
    store.sessions.push(running, closed);

    const probe = new FakeLivenessProbe();
    probe.set(running.id, "missing");

    const { sessions } = expectOk(
      await listSessions(
        depsWith(store, { livenessProbe: probe }),
        { filter: undefined },
        { cwd: scopeA.worktreeRoot, refreshLiveness: true },
      ),
    );

    // Terminal Sessions are never probed; live ones are.
    expect(probe.probed).toEqual([running.id]);

    const refreshed = sessions.find((s) => s.id === running.id)!;
    // The refreshed status reflects process/connection state only — one of the
    // status enum values, never a work-outcome label.
    expect(refreshed.status).toBe("missing");
    // The store row is updated to match.
    const stored = await store.getSessionById(scopeA, running.id);
    expect(stored!.status).toBe("missing");
  });

  test("returns config_not_found when no config is discovered", async () => {
    const store = new FakeStore();
    const d = depsWith(store, {
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    expectErr(
      await listSessions(d, { filter: undefined }, CTX),
      "config_not_found",
    );
  });
});
