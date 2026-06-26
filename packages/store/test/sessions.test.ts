import { describe, expect, test } from "bun:test";
import { isStoreError } from "../src/index.ts";
import { freshStore, makeSession, scopeA, scopeB } from "./helpers.ts";

const scopeC = { ...scopeB, workspaceId: "ws_2" };

describe("Session CRUD", () => {
  test("insert then read back a typed Session", async () => {
    const { store } = freshStore();
    const session = makeSession({ name: "reviewer-1" });
    await store.insertSession(session);

    const got = await store.getSessionById(scopeA, session.id);
    expect(got).toEqual(session);
  });

  test("round-trips a non-null profile and profileSource", async () => {
    const { store } = freshStore();
    const session = makeSession({
      name: "reviewer-1",
      profile: "reviewer",
      profileSource: "project",
    });
    await store.insertSession(session);

    const got = await store.getSessionById(scopeA, session.id);
    expect(got).toEqual(session);
    expect(got?.profile).toBe("reviewer");
    expect(got?.profileSource).toBe("project");
  });

  test("getSessionByName resolves within scope", async () => {
    const { store } = freshStore();
    const session = makeSession({ name: "reviewer-1" });
    await store.insertSession(session);

    const got = await store.getSessionByName(scopeA, "reviewer-1");
    expect(got?.id).toBe(session.id);
  });

  test("missing Session reads return null", async () => {
    const { store } = freshStore();
    expect(await store.getSessionById(scopeA, "nope")).toBeNull();
    expect(await store.getSessionByName(scopeA, "nope")).toBeNull();
  });

  test("updateSession patches only provided fields within scope", async () => {
    const { store } = freshStore();
    const session = makeSession();
    await store.insertSession(session);

    await store.updateSession(scopeA, session.id, {
      status: "closed",
      muxRef: { pane: "new" },
      updatedAt: "2026-06-05T13:00:00Z",
      closedAt: "2026-06-05T13:00:00Z",
    });

    const got = await store.getSessionById(scopeA, session.id);
    expect(got?.status).toBe("closed");
    expect(got?.muxRef).toEqual({ pane: "new" });
    expect(got?.updatedAt).toBe("2026-06-05T13:00:00Z");
    expect(got?.closedAt).toBe("2026-06-05T13:00:00Z");
    // Untouched fields remain.
    expect(got?.name).toBe(session.name);
  });

  test("updateSession with no fields is a no-op", async () => {
    const { store } = freshStore();
    const session = makeSession();
    await store.insertSession(session);
    await store.updateSession(scopeA, session.id, {});
    const got = await store.getSessionById(scopeA, session.id);
    expect(got).toEqual(session);
  });

  test("deleteSessionScoped removes the Session", async () => {
    const { store } = freshStore();
    const session = makeSession();
    await store.insertSession(session);
    await store.deleteSessionScoped(scopeA, session.id);
    expect(await store.getSessionById(scopeA, session.id)).toBeNull();
  });
});

describe("Session duplicate names", () => {
  test("duplicate name in the same scope is a session_name_conflict", async () => {
    const { store } = freshStore();
    await store.insertSession(makeSession({ id: "s_a", name: "dup" }));

    let caught: unknown;
    try {
      await store.insertSession(makeSession({ id: "s_b", name: "dup" }));
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "session_name_conflict")).toBe(true);
  });

  test("duplicate name in the same Workspace conflicts even across worktree roots", async () => {
    const { store } = freshStore();
    await store.insertSession(
      makeSession({
        id: "s_a",
        name: "dup",
        worktreeRoot: scopeA.worktreeRoot,
      }),
    );

    let caught: unknown;
    try {
      await store.insertSession(
        makeSession({
          id: "s_b",
          name: "dup",
          worktreeRoot: scopeB.worktreeRoot,
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "session_name_conflict")).toBe(true);
  });

  test("same name is allowed in a different Workspace", async () => {
    const { store } = freshStore();
    await store.insertSession(makeSession({ id: "s_a", name: "dup" }));

    await expect(
      store.insertSession(
        makeSession({
          id: "s_b",
          name: "dup",
          workspaceId: scopeC.workspaceId,
          worktreeRoot: scopeC.worktreeRoot,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("Session Workspace boundary", () => {
  test("reads cross worktree roots within the same Workspace", async () => {
    const { store } = freshStore();
    const inA = makeSession({
      id: "s_a",
      name: "shared",
      worktreeRoot: scopeA.worktreeRoot,
    });
    await store.insertSession(inA);

    expect(await store.getSessionById(scopeB, "s_a")).toEqual(inA);
    expect((await store.getSessionByName(scopeB, "shared"))?.id).toBe("s_a");
  });

  test("reads do not cross Workspace boundary", async () => {
    const { store } = freshStore();
    await store.insertSession(
      makeSession({
        id: "s_a",
        name: "shared",
        worktreeRoot: scopeA.worktreeRoot,
      }),
    );

    expect(await store.getSessionById(scopeC, "s_a")).toBeNull();
    expect(await store.getSessionByName(scopeC, "shared")).toBeNull();
  });

  test("listSessions returns the Workspace view across worktree roots", async () => {
    const { store } = freshStore();
    await store.insertSession(
      makeSession({ id: "s_a", worktreeRoot: scopeA.worktreeRoot }),
    );
    await store.insertSession(
      makeSession({ id: "s_b", worktreeRoot: scopeB.worktreeRoot }),
    );

    const inA = await store.listSessions(scopeA);
    expect(inA.map((s) => s.id)).toEqual(["s_a", "s_b"]);
    const inB = await store.listSessions(scopeB);
    expect(inB.map((s) => s.id)).toEqual(["s_a", "s_b"]);
  });

  test("updates and deletes in another Workspace do not touch this Workspace", async () => {
    const { store } = freshStore();
    const inA = makeSession({ id: "s_a", worktreeRoot: scopeA.worktreeRoot });
    await store.insertSession(inA);

    await store.updateSession(scopeC, "s_a", { status: "closed" });
    await store.deleteSessionScoped(scopeC, "s_a");

    const stillThere = await store.getSessionById(scopeA, "s_a");
    expect(stillThere?.status).toBe("running");
  });
});

describe("listSessions filters", () => {
  test("filters by status", async () => {
    const { store } = freshStore();
    await store.insertSession(makeSession({ id: "s_run", status: "running" }));
    await store.insertSession(
      makeSession({ id: "s_closed", status: "closed" }),
    );

    const running = await store.listSessions(scopeA, { status: "running" });
    expect(running.map((s) => s.id)).toEqual(["s_run"]);
  });

  test("filters by parentSessionId, including null (root)", async () => {
    const { store } = freshStore();
    await store.insertSession(
      makeSession({ id: "root", parentSessionId: null }),
    );
    await store.insertSession(
      makeSession({ id: "child", parentSessionId: "root" }),
    );

    const roots = await store.listSessions(scopeA, { parentSessionId: null });
    expect(roots.map((s) => s.id)).toEqual(["root"]);

    const children = await store.listSessions(scopeA, {
      parentSessionId: "root",
    });
    expect(children.map((s) => s.id)).toEqual(["child"]);
  });
});
