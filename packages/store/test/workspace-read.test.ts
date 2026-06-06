import { describe, expect, test } from "bun:test";
import {
  freshStore,
  makeMessage,
  makeSession,
  scopeA,
  scopeB,
} from "./helpers.ts";

describe("listSessionsByWorkspace", () => {
  test("returns Sessions across worktree roots sharing the workspace", async () => {
    const { store } = freshStore();
    const a = makeSession({ id: "a", worktreeRoot: scopeA.worktreeRoot });
    const b = makeSession({ id: "b", worktreeRoot: scopeB.worktreeRoot });
    await store.insertSession(a);
    await store.insertSession(b);

    const rows = await store.listSessionsByWorkspace("ws_1");
    expect(rows.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  test("excludes Sessions from other workspaces", async () => {
    const { store } = freshStore();
    await store.insertSession(makeSession({ id: "here" }));
    await store.insertSession(
      makeSession({ id: "other", workspaceId: "ws_2" }),
    );

    const rows = await store.listSessionsByWorkspace("ws_1");
    expect(rows.map((s) => s.id)).toEqual(["here"]);
  });

  test("orders by worktree_root so callers can group", async () => {
    const { store } = freshStore();
    await store.insertSession(
      makeSession({ id: "z", worktreeRoot: "/repo/z" }),
    );
    await store.insertSession(
      makeSession({ id: "a", worktreeRoot: "/repo/a" }),
    );

    const rows = await store.listSessionsByWorkspace("ws_1");
    expect(rows.map((s) => s.worktreeRoot)).toEqual(["/repo/a", "/repo/z"]);
  });

  test("applies the status filter", async () => {
    const { store } = freshStore();
    await store.insertSession(makeSession({ id: "r", status: "running" }));
    await store.insertSession(makeSession({ id: "c", status: "closed" }));

    const rows = await store.listSessionsByWorkspace("ws_1", {
      status: "running",
    });
    expect(rows.map((s) => s.id)).toEqual(["r"]);
  });
});

describe("listMessagesByWorkspace", () => {
  test("returns Messages across worktree roots sharing the workspace", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "m1", worktreeRoot: scopeA.worktreeRoot }),
    );
    await store.insertMessage(
      makeMessage({ id: "m2", worktreeRoot: scopeB.worktreeRoot }),
    );

    const rows = await store.listMessagesByWorkspace("ws_1");
    expect(rows.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  test("undelivered filter narrows to records with no delivered_at", async () => {
    const { store } = freshStore();
    await store.insertMessage(
      makeMessage({ id: "pending", deliveredAt: null }),
    );
    await store.insertMessage(
      makeMessage({ id: "done", deliveredAt: "2026-06-05T12:01:00Z" }),
    );

    const rows = await store.listMessagesByWorkspace("ws_1", {
      undelivered: true,
    });
    expect(rows.map((m) => m.id)).toEqual(["pending"]);
  });
});
