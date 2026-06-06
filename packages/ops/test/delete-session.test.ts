import { describe, expect, test } from "bun:test";
import { hashToken } from "@asem/core";
import { deleteSession } from "../src/index.ts";
import {
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
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
const CURRENT_TOKEN = "tok-current";

function deps(
  overrides: {
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
  } = {},
) {
  const store = overrides.store ?? new FakeStore();
  const logger = new MemoryLogger();
  const bundle = makeOpsDeps({
    store,
    logger,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, store, logger };
}

describe("deleteSession — confirmation/force", () => {
  test("refuses to delete without explicit force", async () => {
    const store = new FakeStore();
    const session = makeSession({ id: "s_del", name: "victim" });
    store.sessions.push(session);
    const d = deps({ store });

    const result = await deleteSession(d, { id: "s_del", force: false }, CTX);
    expectErr(result, "invalid_input");
    // Nothing removed.
    expect(await d.store.getSessionById(scopeA, "s_del")).not.toBeNull();
  });

  test("refuses to delete when force is omitted entirely", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_del", name: "victim" }));
    const d = deps({ store });

    expectErr(await deleteSession(d, { id: "s_del" }, CTX), "invalid_input");
    expect(await d.store.getSessionById(scopeA, "s_del")).not.toBeNull();
  });
});

describe("deleteSession — destructive removal + related cleanup", () => {
  test("deletes the Session and only its related Messages, returning the count", async () => {
    const store = new FakeStore();
    const session = makeSession({ id: "s_del", name: "victim" });
    store.sessions.push(session);
    // Related: the Session is sender or recipient.
    store.messages.push(
      makeMessage({ id: "m_to", toSessionId: "s_del" }),
      makeMessage({ id: "m_from", fromSessionId: "s_del", toSessionId: "s_o" }),
      // Unrelated: neither sender nor recipient.
      makeMessage({ id: "m_other", toSessionId: "s_o" }),
    );
    const d = deps({ store });

    const result = expectOk(
      await deleteSession(d, { id: "s_del", force: true }, CTX),
    );

    expect(result.deletedSessionId).toBe("s_del");
    expect(result.deletedMessageCount).toBe(2);
    expect(await d.store.getSessionById(scopeA, "s_del")).toBeNull();
    expect(d.store.messages.map((m) => m.id)).toEqual(["m_other"]);
  });

  test("deletes a Session with no related Messages", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_del", name: "victim" }));
    const d = deps({ store });

    const result = expectOk(
      await deleteSession(d, { id: "s_del", force: true }, CTX),
    );
    expect(result.deletedMessageCount).toBe(0);
    expect(await d.store.getSessionById(scopeA, "s_del")).toBeNull();
  });
});

describe("deleteSession — scoped lookup", () => {
  test("a Session in a sibling worktree is not found (cross-worktree rejection)", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({
        id: "s_b",
        name: "victim",
        workspaceId: scopeB.workspaceId,
        worktreeRoot: scopeB.worktreeRoot,
      }),
    );
    const d = deps({ store });

    expectErr(
      await deleteSession(d, { id: "s_b", force: true }, CTX),
      "session_not_found",
    );
    // The sibling-worktree Session is untouched.
    expect(await d.store.getSessionById(scopeB, "s_b")).not.toBeNull();
  });
});

describe("deleteSession — transactional rollback", () => {
  /** A store whose Session delete throws after related Messages were removed. */
  class ThrowingDeleteStore extends FakeStore {
    override async deleteSessionScoped(): Promise<void> {
      throw new Error("session delete failed mid-transaction");
    }
  }

  test("rolls back the related-message deletion when the Session delete fails", async () => {
    const store = new ThrowingDeleteStore();
    store.sessions.push(makeSession({ id: "s_del", name: "victim" }));
    store.messages.push(makeMessage({ id: "m_to", toSessionId: "s_del" }));
    const d = deps({ store });

    // The thrown defect propagates (it is not a recoverable operation error).
    await expect(
      deleteSession(d, { id: "s_del", force: true }, CTX),
    ).rejects.toThrow(/mid-transaction/);

    // All-or-nothing: the Session and its Message are both intact.
    expect(await store.getSessionById(scopeA, "s_del")).not.toBeNull();
    expect(store.messages.map((m) => m.id)).toEqual(["m_to"]);
  });
});

describe("deleteSession — scope isolation of related cleanup", () => {
  test("related-message cleanup stays within the operating scope", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_del", name: "victim" }));
    // A same-id Session in another worktree would relate to its own messages;
    // here we plant a related message in scopeB and confirm it is left alone.
    store.messages.push(
      makeMessage({ id: "m_a", toSessionId: "s_del" }),
      makeMessage({
        id: "m_b",
        toSessionId: "s_del",
        workspaceId: scopeB.workspaceId,
        worktreeRoot: scopeB.worktreeRoot,
      }),
    );
    const d = deps({ store });

    const result = expectOk(
      await deleteSession(d, { id: "s_del", force: true }, CTX),
    );
    expect(result.deletedMessageCount).toBe(1);
    const scopeBMessages = await d.store.listMessages(scopeB);
    expect(scopeBMessages.map((m) => m.id)).toEqual(["m_b"]);
  });
});

describe("deleteSession — auth", () => {
  test("an invalid current-Session token is rejected before any deletion", async () => {
    const store = new FakeStore();
    const session = makeSession({ id: "s_del", name: "victim" });
    const me = makeSession({
      id: "cur_1",
      name: "helper-1",
      tokenHash: hashToken(CURRENT_TOKEN),
    });
    store.sessions.push(session, me);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: "wrong-token",
      }),
    });

    expectErr(
      await deleteSession(d, { id: "s_del", force: true }, CTX),
      "invalid_session_token",
    );
    expect(await d.store.getSessionById(scopeA, "s_del")).not.toBeNull();
  });
});
