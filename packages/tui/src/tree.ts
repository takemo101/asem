/**
 * Left-pane Session tree construction.
 *
 * Two shapes share one builder:
 * - `worktree` scope: a single group of parent-child trees over the current
 *   worktree's Sessions (the host loads only that worktree's Sessions, so this
 *   stays a location filter — ADR 0008);
 * - `workspace` scope: one Workspace parent-child tree over *all* in-scope
 *   Sessions. After [ADR 0008](../../docs/adr/0008-workspace-scoped-session-tree.md)
 *   the Workspace — not `worktree_root` — is the relationship boundary, so a
 *   Workspace root Session adopts its repo parent children even when they live
 *   in different worktree roots. `worktree_root` rides along as per-row location
 *   metadata for badges (design "Global tree + repo badges").
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
 * Both scopes now build a single Workspace parent-child forest: in `worktree`
 * scope the host has already filtered Sessions to the current worktree root, and
 * in `workspace` scope parent-child links are resolved across *all* in-scope
 * Sessions so a Workspace root adopts repo parent children regardless of their
 * `worktree_root` (ADR 0008). The single group's `worktreeRoot` is the scope's
 * reference root; per-row location lives on each {@link VisibleSessionRow}.
 */
export function buildSessionTree(
  sessions: Session[],
  scopeMode: CockpitScopeMode,
  currentWorktreeRoot: string,
): SessionTree {
  const group: WorktreeGroup = {
    worktreeRoot: currentWorktreeRoot,
    nodes: buildNodes(sessions),
  };
  return { scopeMode, groups: [group] };
}

/**
 * Flatten a tree to the selectable rows in render order (pre-order). Each row
 * carries its own Session's `worktree_root` as location metadata so the renderer
 * can badge root vs repo Sessions. Selection and keyboard navigation index into
 * this list.
 */
export function flattenTree(tree: SessionTree): VisibleSessionRow[] {
  const rows: VisibleSessionRow[] = [];
  const walk = (nodes: SessionTreeNode[]): void => {
    for (const node of nodes) {
      rows.push({
        session: node.session,
        depth: node.depth,
        worktreeRoot: node.session.worktreeRoot,
      });
      walk(node.children);
    }
  };
  for (const group of tree.groups) {
    walk(group.nodes);
  }
  return rows;
}
