import { describe, expect, test } from "bun:test";
import { getSession } from "../src/index.ts";
import {
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

describe("getSession", () => {
  test("reads a Session in the current scope", async () => {
    const store = new FakeStore();
    const s = makeSession({ name: "reviewer" });
    store.sessions.push(s);

    const { session } = expectOk(
      await getSession(depsWith(store), { id: s.id }, CTX),
    );
    expect(session.id).toBe(s.id);
    expect(session.name).toBe("reviewer");
  });

  test("reports a Session in a sibling worktree as session_not_found", async () => {
    const store = new FakeStore();
    // Registered in scopeB; the lookup runs in scopeA → must not leak (ADR 0002).
    const other = makeSession({
      name: "b",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
    });
    store.sessions.push(other);

    expectErr(
      await getSession(depsWith(store), { id: other.id }, CTX),
      "session_not_found",
    );
  });

  test("returns session_not_found for an unknown id", async () => {
    const store = new FakeStore();
    expectErr(
      await getSession(depsWith(store), { id: "nope" }, CTX),
      "session_not_found",
    );
  });

  test("does not probe liveness unless asked", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);
    const probe = new FakeLivenessProbe();

    expectOk(
      await getSession(depsWith(store, { livenessProbe: probe }), { id: s.id }, CTX),
    );
    expect(probe.probed).toHaveLength(0);
  });

  test("refreshLiveness updates the stored status from the probe", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);

    const probe = new FakeLivenessProbe();
    probe.set(s.id, "exited");

    const { session } = expectOk(
      await getSession(
        depsWith(store, { livenessProbe: probe }),
        { id: s.id },
        { cwd: scopeA.worktreeRoot, refreshLiveness: true },
      ),
    );
    expect(probe.probed).toEqual([s.id]);
    expect(session.status).toBe("exited");
    const stored = await store.getSessionById(scopeA, s.id);
    expect(stored!.status).toBe("exited");
  });
});
