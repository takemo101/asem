import { describe, expect, test } from "bun:test";
import { freshStore, makeMessage, scopeA, scopeB } from "./helpers.ts";

const scopeC = { ...scopeB, workspaceId: "ws_2" };

describe("Message CRUD", () => {
  test("insert then list returns a typed Message", async () => {
    const { store } = freshStore();
    const message = makeMessage({ id: "m_1", toSessionId: "s_x" });
    await store.insertMessage(message);

    const got = await store.listMessages(scopeA);
    expect(got).toEqual([message]);
  });

  test("lists in chronological (created_at, id) order", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_2", createdAt: "2026-06-05T12:00:02Z" }),
    );
    await store.insertMessage(
      makeMessage({ id: "m_1", createdAt: "2026-06-05T12:00:01Z" }),
    );
    const got = await store.listMessages(scopeA);
    expect(got.map((m) => m.id)).toEqual(["m_1", "m_2"]);
  });
});

describe("Message Workspace boundary", () => {
  test("listMessages returns the Workspace view across worktree roots", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_a", worktreeRoot: scopeA.worktreeRoot }),
    );
    await store.insertMessage(
      makeMessage({ id: "m_b", worktreeRoot: scopeB.worktreeRoot }),
    );

    expect((await store.listMessages(scopeA)).map((m) => m.id)).toEqual([
      "m_a",
      "m_b",
    ]);
    expect((await store.listMessages(scopeB)).map((m) => m.id)).toEqual([
      "m_a",
      "m_b",
    ]);
  });

  test("listMessages does not cross Workspace boundary", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_a", worktreeRoot: scopeA.worktreeRoot }),
    );

    expect(await store.listMessages(scopeC)).toEqual([]);
  });
});

describe("Message filters / indexed queries", () => {
  test("filters by toSessionId (indexed)", async () => {
    const { store } = freshStore();
    await store.insertMessage(makeMessage({ id: "m_1", toSessionId: "s_x" }));
    await store.insertMessage(makeMessage({ id: "m_2", toSessionId: "s_y" }));

    const toX = await store.listMessages(scopeA, { toSessionId: "s_x" });
    expect(toX.map((m) => m.id)).toEqual(["m_1"]);
  });

  test("filters undelivered messages (delivery_error index column)", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_pending", deliveredAt: null }),
    );
    await store.insertMessage(
      makeMessage({ id: "m_done", deliveredAt: "2026-06-05T12:30:00Z" }),
    );

    const undelivered = await store.listMessages(scopeA, { undelivered: true });
    expect(undelivered.map((m) => m.id)).toEqual(["m_pending"]);
  });

  test("inbox flag alone is not resolved by the store", async () => {
    // Store has no current-Session concept; `inbox` is an ops-level filter.
    const { store } = freshStore();
    await store.insertMessage(makeMessage({ id: "m_1", toSessionId: "s_x" }));
    await store.insertMessage(makeMessage({ id: "m_2", toSessionId: "s_y" }));

    const all = await store.listMessages(scopeA, { inbox: true });
    expect(all.map((m) => m.id).sort()).toEqual(["m_1", "m_2"]);
  });
});

describe("Message delivery state", () => {
  test("markMessageDelivered sets delivered_at and clears error", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_1", deliveryError: "boom" }),
    );
    await store.markMessageDelivered(scopeA, "m_1", "2026-06-05T12:30:00Z");

    const [got] = await store.listMessages(scopeA);
    expect(got?.deliveredAt).toBe("2026-06-05T12:30:00Z");
    expect(got?.deliveryError).toBeNull();
  });

  test("markMessageDeliveryError sets error and clears delivered_at", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_1", deliveredAt: "2026-06-05T12:30:00Z" }),
    );
    await store.markMessageDeliveryError(scopeA, "m_1", "pane missing");

    const [got] = await store.listMessages(scopeA);
    expect(got?.deliveryError).toBe("pane missing");
    expect(got?.deliveredAt).toBeNull();
  });

  test("delivery updates can cross worktree roots in the same Workspace", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_a", worktreeRoot: scopeA.worktreeRoot }),
    );
    await store.markMessageDelivered(scopeB, "m_a", "2026-06-05T12:30:00Z");

    const [got] = await store.listMessages(scopeA);
    expect(got?.deliveredAt).toBe("2026-06-05T12:30:00Z");
  });

  test("delivery updates do not cross Workspace boundary", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m_a", worktreeRoot: scopeA.worktreeRoot }),
    );
    await store.markMessageDelivered(scopeC, "m_a", "2026-06-05T12:30:00Z");

    const [got] = await store.listMessages(scopeA);
    expect(got?.deliveredAt).toBeNull();
  });
});
