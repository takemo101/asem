import { describe, expect, test } from "bun:test";
import type { Store } from "../src/index.ts";
import {
  freshStore,
  makeMessage,
  makeSession,
  scopeA,
  scopeB,
} from "./helpers.ts";

describe("withTransaction — delete_session primitives", () => {
  test("deletes a scoped Session and its related Messages atomically", async () => {
    const { store } = freshStore();
    const session = makeSession({ id: "s_del", name: "victim" });
    await store.insertSession(session);
    // Messages where the session is sender or recipient are "related".
    await store.insertMessage(
      makeMessage({ id: "m_to", toSessionId: "s_del" }),
    );
    await store.insertMessage(
      makeMessage({
        id: "m_from",
        fromSessionId: "s_del",
        toSessionId: "s_other",
      }),
    );
    await store.insertMessage(
      makeMessage({ id: "m_unrelated", toSessionId: "s_other" }),
    );

    const removed = await store.withTransaction(async (tx: Store) => {
      const count = await tx.deleteRelatedMessagesScoped(scopeA, "s_del");
      await tx.deleteSessionScoped(scopeA, "s_del");
      return count;
    });

    expect(removed).toBe(2);
    expect(await store.getSessionById(scopeA, "s_del")).toBeNull();
    const remaining = await store.listMessages(scopeA);
    expect(remaining.map((m) => m.id)).toEqual(["m_unrelated"]);
  });

  test("rolls back all writes when the transaction body throws", async () => {
    const { store } = freshStore();
    const session = makeSession({ id: "s_keep", name: "keep" });
    await store.insertSession(session);
    await store.insertMessage(
      makeMessage({ id: "m_keep", toSessionId: "s_keep" }),
    );

    const boom = new Error("operation decided to abort");
    await expect(
      store.withTransaction(async (tx: Store) => {
        await tx.deleteRelatedMessagesScoped(scopeA, "s_keep");
        await tx.deleteSessionScoped(scopeA, "s_keep");
        throw boom;
      }),
    ).rejects.toBe(boom);

    // Nothing was committed.
    expect(await store.getSessionById(scopeA, "s_keep")).not.toBeNull();
    expect((await store.listMessages(scopeA)).map((m) => m.id)).toEqual([
      "m_keep",
    ]);
  });

  test("returns the body's value on commit", async () => {
    const { store } = freshStore();
    const value = await store.withTransaction(async () => 42);
    expect(value).toBe(42);
  });

  test("rejects nested transactions", async () => {
    const { store } = freshStore();
    await expect(
      store.withTransaction(async (tx: Store) => {
        await tx.withTransaction(async () => undefined);
      }),
    ).rejects.toThrow(/nesting/);
  });

  test("related-message deletion stays within scope", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({
        id: "m_a",
        toSessionId: "s_del",
        worktreeRoot: scopeA.worktreeRoot,
      }),
    );
    await store.insertMessage(
      makeMessage({
        id: "m_b",
        toSessionId: "s_del",
        worktreeRoot: scopeB.worktreeRoot,
      }),
    );

    // Deleting related messages for s_del in scopeA must not touch scopeB.
    const removed = await store.deleteRelatedMessagesScoped(scopeA, "s_del");
    expect(removed).toBe(1);
    expect((await store.listMessages(scopeB)).map((m) => m.id)).toEqual([
      "m_b",
    ]);
  });
});
