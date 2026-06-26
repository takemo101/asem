import { describe, expect, test } from "bun:test";
import { buildSessionTree, filterSessions, flattenTree } from "../src/index.ts";
import { makeSession, WORKSPACE, WORKTREE_A, WORKTREE_B } from "./helpers.ts";

function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("expected value to be defined");
  }
  return value;
}

describe("buildSessionTree (worktree scope)", () => {
  test("nests children under their parent with increasing depth", () => {
    const parent = makeSession({ id: "p", name: "parent" });
    const child = makeSession({
      id: "c",
      name: "child",
      parentSessionId: "p",
    });
    const grandchild = makeSession({
      id: "g",
      name: "grandchild",
      parentSessionId: "c",
    });

    const tree = buildSessionTree(
      [grandchild, child, parent],
      "worktree",
      WORKTREE_A,
    );

    expect(tree.groups).toHaveLength(1);
    const roots = defined(tree.groups[0]).nodes;
    expect(roots).toHaveLength(1);
    const root = defined(roots[0]);
    expect(root.session.id).toBe("p");
    expect(root.depth).toBe(0);
    const c = defined(root.children[0]);
    expect(c.session.id).toBe("c");
    expect(c.depth).toBe(1);
    const g = defined(c.children[0]);
    expect(g.session.id).toBe("g");
    expect(g.depth).toBe(2);
  });

  test("a parent missing from scope leaves the child as a root node", () => {
    const orphan = makeSession({ id: "o", parentSessionId: "ghost" });
    const tree = buildSessionTree([orphan], "worktree", WORKTREE_A);
    const roots = defined(tree.groups[0]).nodes;
    expect(roots).toHaveLength(1);
    const root = defined(roots[0]);
    expect(root.session.id).toBe("o");
    expect(root.depth).toBe(0);
  });

  test("siblings are ordered by created_at then id", () => {
    const a = makeSession({ id: "a", createdAt: "2026-06-05T12:00:02.000Z" });
    const b = makeSession({ id: "b", createdAt: "2026-06-05T12:00:01.000Z" });
    const tree = buildSessionTree([a, b], "worktree", WORKTREE_A);
    const ids = defined(tree.groups[0]).nodes.map((n) => n.session.id);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("buildSessionTree (workspace scope)", () => {
  test("resolves parent-child links across worktree roots into one Workspace tree", () => {
    // After ADR 0008 the Workspace is the relationship boundary, so a child
    // adopts its parent even when they live in different worktree roots.
    const parentA = makeSession({ id: "pa", worktreeRoot: WORKTREE_A });
    const childB = makeSession({
      id: "cb",
      worktreeRoot: WORKTREE_B,
      parentSessionId: "pa",
    });

    const tree = buildSessionTree([parentA, childB], "workspace", WORKTREE_A);

    // One Workspace tree, not one disconnected root per worktree group.
    expect(tree.groups).toHaveLength(1);
    const roots = defined(tree.groups[0]).nodes;
    expect(roots).toHaveLength(1);
    const root = defined(roots[0]);
    expect(root.session.id).toBe("pa");
    const child = defined(root.children[0]);
    expect(child.session.id).toBe("cb");
    expect(child.depth).toBe(1);
  });

  test("flattens a Workspace root with repo children in different worktrees", () => {
    const root = makeSession({
      id: "root",
      name: "root",
      worktreeRoot: "/workspace",
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const frontend = makeSession({
      id: "fe",
      name: "frontend-parent",
      worktreeRoot: "/workspace/frontend",
      parentSessionId: "root",
      createdAt: "2026-06-05T12:00:01.000Z",
    });
    const backend = makeSession({
      id: "be",
      name: "backend-parent",
      worktreeRoot: "/workspace/backend",
      parentSessionId: "root",
      createdAt: "2026-06-05T12:00:02.000Z",
    });

    const tree = buildSessionTree(
      [backend, frontend, root],
      "workspace",
      "/workspace",
    );
    const rows = flattenTree(tree);

    // Root then both children at depth 1, regardless of worktree root.
    expect(rows.map((r) => r.session.id)).toEqual(["root", "fe", "be"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    // Each row keeps its own location metadata for badge/rendering.
    expect(rows.map((r) => r.worktreeRoot)).toEqual([
      "/workspace",
      "/workspace/frontend",
      "/workspace/backend",
    ]);
  });
});

describe("filterSessions", () => {
  test("'all' keeps every Session", () => {
    const sessions = [
      makeSession({ status: "running" }),
      makeSession({ status: "closed" }),
    ];
    expect(filterSessions(sessions, "all")).toHaveLength(2);
  });

  test("a status filter keeps only matching Sessions", () => {
    const running = makeSession({ status: "running" });
    const closed = makeSession({ status: "closed" });
    const filtered = filterSessions([running, closed], "running");
    expect(filtered.map((s) => s.id)).toEqual([running.id]);
  });
});

describe("flattenTree", () => {
  test("emits rows in pre-order across groups", () => {
    const a1 = makeSession({ id: "a1", worktreeRoot: WORKTREE_A });
    const a2 = makeSession({
      id: "a2",
      worktreeRoot: WORKTREE_A,
      parentSessionId: "a1",
    });
    const b1 = makeSession({ id: "b1", worktreeRoot: WORKTREE_B });
    const tree = buildSessionTree([a1, a2, b1], "workspace", WORKTREE_A);

    const rows = flattenTree(tree);
    expect(rows.map((r) => r.session.id)).toEqual(["a1", "a2", "b1"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0]);
    expect(defined(rows[2]).worktreeRoot).toBe(WORKTREE_B);
  });

  test("scope value is carried on the tree", () => {
    const tree = buildSessionTree([], "worktree", WORKTREE_A);
    expect(tree.scopeMode).toBe("worktree");
    expect(WORKSPACE).toBe("ws_1");
  });
});
