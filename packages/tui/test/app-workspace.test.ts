import { describe, expect, test } from "bun:test";
import { hashToken } from "@asem/core";
import {
  FakeCurrentSessionResolver,
  FakeStore,
} from "../../ops/src/testing/fakes.ts";
import { makeApp } from "./app-helpers.ts";
import { makeSession, WORKTREE_A, WORKTREE_B } from "./helpers.ts";

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
