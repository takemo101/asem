import { describe, expect, test } from "bun:test";
import { buildSessionTree, filterSessions, flattenTree } from "../src/index.ts";
import { makeSession, WORKSPACE, WORKTREE_A, WORKTREE_B } from "./helpers.ts";

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
    const roots = tree.groups[0]!.nodes;
    expect(roots).toHaveLength(1);
    expect(roots[0]!.session.id).toBe("p");
    expect(roots[0]!.depth).toBe(0);
    const c = roots[0]!.children[0]!;
    expect(c.session.id).toBe("c");
    expect(c.depth).toBe(1);
    expect(c.children[0]!.session.id).toBe("g");
    expect(c.children[0]!.depth).toBe(2);
  });

  test("a parent missing from scope leaves the child as a root node", () => {
    const orphan = makeSession({ id: "o", parentSessionId: "ghost" });
    const tree = buildSessionTree([orphan], "worktree", WORKTREE_A);
    const roots = tree.groups[0]!.nodes;
    expect(roots).toHaveLength(1);
    expect(roots[0]!.session.id).toBe("o");
    expect(roots[0]!.depth).toBe(0);
  });

  test("siblings are ordered by created_at then id", () => {
    const a = makeSession({ id: "a", createdAt: "2026-06-05T12:00:02.000Z" });
    const b = makeSession({ id: "b", createdAt: "2026-06-05T12:00:01.000Z" });
    const tree = buildSessionTree([a, b], "worktree", WORKTREE_A);
    const ids = tree.groups[0]!.nodes.map((n) => n.session.id);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("buildSessionTree (workspace scope)", () => {
  test("groups Sessions by worktree_root before building each tree", () => {
    const a1 = makeSession({ id: "a1", worktreeRoot: WORKTREE_A });
    const a2 = makeSession({
      id: "a2",
      worktreeRoot: WORKTREE_A,
      parentSessionId: "a1",
    });
    const b1 = makeSession({ id: "b1", worktreeRoot: WORKTREE_B });

    const tree = buildSessionTree([a1, a2, b1], "workspace", WORKTREE_A);

    expect(tree.groups.map((g) => g.worktreeRoot)).toEqual([
      WORKTREE_A,
      WORKTREE_B,
    ]);
    const groupA = tree.groups.find((g) => g.worktreeRoot === WORKTREE_A)!;
    expect(groupA.nodes).toHaveLength(1);
    expect(groupA.nodes[0]!.session.id).toBe("a1");
    expect(groupA.nodes[0]!.children[0]!.session.id).toBe("a2");
  });

  test("parent-child links never cross a worktree group", () => {
    // Child in worktree B names a parent that lives in worktree A: isolation
    // means it must not be adopted across the boundary.
    const parentA = makeSession({ id: "pa", worktreeRoot: WORKTREE_A });
    const childB = makeSession({
      id: "cb",
      worktreeRoot: WORKTREE_B,
      parentSessionId: "pa",
    });

    const tree = buildSessionTree([parentA, childB], "workspace", WORKTREE_A);

    const groupB = tree.groups.find((g) => g.worktreeRoot === WORKTREE_B)!;
    expect(groupB.nodes).toHaveLength(1);
    // The child is a root inside its own group, not nested under the A parent.
    expect(groupB.nodes[0]!.session.id).toBe("cb");
    expect(groupB.nodes[0]!.depth).toBe(0);
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
    expect(rows[2]!.worktreeRoot).toBe(WORKTREE_B);
  });

  test("scope value is carried on the tree", () => {
    const tree = buildSessionTree([], "worktree", WORKTREE_A);
    expect(tree.scopeMode).toBe("worktree");
    expect(WORKSPACE).toBe("ws_1");
  });
});
