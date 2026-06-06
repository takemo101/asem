/**
 * Left-pane Session tree construction.
 *
 * Two shapes share one builder:
 * - `worktree` scope: a single group of parent-child trees over the current
 *   worktree's Sessions;
 * - `workspace` scope: Sessions grouped by `worktree_root` first, then a tree
 *   per group. Parent-child links are resolved *within* a group only, so a
 *   parent in a sibling worktree never adopts a child across the isolation
 *   boundary (CONTEXT.md "Worktree isolation").
 *
 * Ordering mirrors the store (`created_at`, then `id`) so the cockpit and the
 * underlying queries agree on row order.
 */
import type { Session } from "@asem/core";
import type {
  CockpitScopeMode,
  CockpitStatusFilter,
  SessionTree,
  SessionTreeNode,
  VisibleSessionRow,
  WorktreeGroup,
} from "./types.ts";

function byCreatedThenId(a: Session, b: Session): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

/** Keep only Sessions matching the status filter (`"all"` keeps everything). */
export function filterSessions(
  sessions: Session[],
  filter: CockpitStatusFilter,
): Session[] {
  return filter === "all"
    ? sessions
    : sessions.filter((s) => s.status === filter);
}

/**
 * Build the parent-child forest for one already-grouped set of Sessions.
 *
 * A Session whose `parent_session_id` is null or points outside this set is a
 * root. Children inherit `depth + 1`. A `seen` set guards against a malformed
 * parent cycle so traversal always terminates.
 */
function buildNodes(sessions: Session[]): SessionTreeNode[] {
  const ordered = [...sessions].sort(byCreatedThenId);
  const byId = new Map(ordered.map((s) => [s.id, s]));
  const childrenByParent = new Map<string | null, Session[]>();

  for (const session of ordered) {
    const parentId =
      session.parentSessionId !== null && byId.has(session.parentSessionId)
        ? session.parentSessionId
        : null;
    const siblings = childrenByParent.get(parentId);
    if (siblings === undefined) {
      childrenByParent.set(parentId, [session]);
    } else {
      siblings.push(session);
    }
  }

  const seen = new Set<string>();
  const toNodes = (parents: Session[], depth: number): SessionTreeNode[] =>
    parents
      .filter((session) => !seen.has(session.id))
      .map((session) => {
        seen.add(session.id);
        const children = childrenByParent.get(session.id) ?? [];
        return {
          session,
          depth,
          children: toNodes(children, depth + 1),
        } satisfies SessionTreeNode;
      });

  return toNodes(childrenByParent.get(null) ?? [], 0);
}

/**
 * Build the left-pane tree for a snapshot's Sessions.
 *
 * In `worktree` scope every Session belongs to one group keyed by the current
 * worktree root. In `workspace` scope Sessions are grouped by their own
 * `worktree_root` (sorted for stable rendering) before each group's tree is
 * built.
 */
export function buildSessionTree(
  sessions: Session[],
  scopeMode: CockpitScopeMode,
  currentWorktreeRoot: string,
): SessionTree {
  if (scopeMode === "worktree") {
    return {
      scopeMode,
      groups: [
        { worktreeRoot: currentWorktreeRoot, nodes: buildNodes(sessions) },
      ],
    };
  }

  const byRoot = new Map<string, Session[]>();
  for (const session of sessions) {
    const bucket = byRoot.get(session.worktreeRoot);
    if (bucket === undefined) {
      byRoot.set(session.worktreeRoot, [session]);
    } else {
      bucket.push(session);
    }
  }

  const groups: WorktreeGroup[] = [...byRoot.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((worktreeRoot) => ({
      worktreeRoot,
      nodes: buildNodes(byRoot.get(worktreeRoot) ?? []),
    }));

  return { scopeMode, groups };
}

/**
 * Flatten a tree to the selectable rows in render order (each group's nodes in
 * pre-order). Selection and keyboard navigation index into this list.
 */
export function flattenTree(tree: SessionTree): VisibleSessionRow[] {
  const rows: VisibleSessionRow[] = [];
  const walk = (nodes: SessionTreeNode[], worktreeRoot: string): void => {
    for (const node of nodes) {
      rows.push({ session: node.session, depth: node.depth, worktreeRoot });
      walk(node.children, worktreeRoot);
    }
  };
  for (const group of tree.groups) {
    walk(group.nodes, group.worktreeRoot);
  }
  return rows;
}
