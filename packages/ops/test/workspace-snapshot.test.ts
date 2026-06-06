import { describe, expect, test } from "bun:test";
import { loadWorkspaceSnapshot } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeScopeResolver,
  FakeStore,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import {
  expectErr,
  expectOk,
  makeMessage,
  makeSession,
  scopeA,
  scopeB,
} from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };

function depsWith(store: FakeStore) {
  return makeOpsDeps({ store, scopeResolver: new FakeScopeResolver(scopeA) });
}

describe("loadWorkspaceSnapshot", () => {
  test("returns Sessions and Messages across worktree roots in the workspace", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", worktreeRoot: scopeA.worktreeRoot }),
      makeSession({
        id: "b",
        worktreeRoot: scopeB.worktreeRoot,
        workspaceId: scopeB.workspaceId,
      }),
    );
    store.messages.push(
      makeMessage({ id: "m1", worktreeRoot: scopeA.worktreeRoot }),
      makeMessage({
        id: "m2",
        worktreeRoot: scopeB.worktreeRoot,
        workspaceId: scopeB.workspaceId,
      }),
    );

    const snap = expectOk(await loadWorkspaceSnapshot(depsWith(store), CTX));
    expect(snap.sessions.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(snap.messages.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  test("excludes other workspaces", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "here" }),
      makeSession({
        id: "other",
        workspaceId: "ws_2",
        worktreeRoot: "/elsewhere",
      }),
    );
    const snap = expectOk(await loadWorkspaceSnapshot(depsWith(store), CTX));
    expect(snap.sessions.map((s) => s.id)).toEqual(["here"]);
  });

  test("propagates a structured config error unchanged", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    expectErr(await loadWorkspaceSnapshot(deps, CTX), "config_not_found");
  });
});
