/**
 * Detail- and Context-tab projections for the selected Session.
 *
 * Both are pure mappings from a Session (plus, for Context, the resolved
 * {@link CockpitEnv}) to the fields the design lists under "Detail tabs". They
 * surface process/connection state and configuration only — never a work
 * outcome.
 */
import type { MuxRef, Session } from "@asem/core";
import type {
  CockpitEnv,
  ContextView,
  DetailView,
  RelationshipView,
} from "./types.ts";

/**
 * Detail-tab projection. The parent is shown as the parent Session's name when
 * it is resolvable in the snapshot, otherwise its raw id, otherwise `-`. The
 * attach hint is supplied by the host (from `get_session`) when known.
 */
export function detailView(
  session: Session,
  sessions: Session[],
  attachHint: string | null = null,
): DetailView {
  const parentLabel =
    session.parentSessionId === null
      ? "-"
      : (sessions.find((s) => s.id === session.parentSessionId)?.name ??
        session.parentSessionId);

  return {
    muxRefSummary: summarizeMuxRef(session.muxRef),
    id: session.id,
    name: session.name,
    status: session.status,
    agent: session.agent,
    mux: session.mux,
    model: session.model,
    profile: session.profile,
    profileSource: session.profileSource,
    parentLabel,
    parentSessionId: session.parentSessionId,
    cwd: session.cwd,
    worktreeRoot: session.worktreeRoot,
    sessionDir: session.sessionDir,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    closedAt: session.closedAt,
    attachHint,
  };
}

/** `key=value` summary of a mux ref, with stable key order. */
function summarizeMuxRef(muxRef: MuxRef): string {
  return Object.keys(muxRef)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = muxRef[key];
      return `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .join(", ");
}

/** Row order mirrors the store/left pane: `created_at`, then `id`. */
function byCreatedThenId(a: Session, b: Session): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

/**
 * Build the relationship card for the selected Session, ordered parent →
 * selected → children (spec "Context"). Links are resolved across the whole
 * in-scope Session set (not just the same `worktree_root`), because after ADR
 * 0008 the Workspace is the parent/report boundary. Each related Session keeps
 * its own location so the card can explain "who supervises whom" and "where
 * each runs" separately.
 */
function relationshipView(
  selected: Session,
  sessions: Session[],
): RelationshipView {
  const parentId = selected.parentSessionId;
  const parent =
    parentId === null
      ? null
      : (sessions.find((s) => s.id === parentId) ?? null);
  const children = sessions
    .filter((s) => s.parentSessionId === selected.id)
    .sort(byCreatedThenId)
    .map((s) => ({
      id: s.id,
      name: s.name,
      location: s.worktreeRoot,
    }));

  return {
    parentSessionId: parentId,
    parent:
      parent === null
        ? parentId === null
          ? null
          : { id: parentId, name: null, location: null }
        : { id: parent.id, name: parent.name, location: parent.worktreeRoot },
    selected: {
      id: selected.id,
      name: selected.name,
      location: selected.worktreeRoot,
    },
    children,
    scopeNote:
      "parent and report delivery are same-Workspace (by workspace_id), independent of worktree_root",
  };
}

/**
 * Context-tab projection: scope identifiers, config path, and config-derived
 * defaults, plus the selected Session's mux-ref summary and Workspace
 * relationship card (both null when no Session is selected). Pass the in-scope
 * Sessions so the relationship card can resolve parent/sibling links across
 * worktree roots.
 */
export function contextView(
  env: CockpitEnv,
  selected: Session | null,
  sessions: Session[] = [],
): ContextView {
  return {
    workspaceId: env.workspaceId,
    worktreeRoot: env.worktreeRoot,
    cwd: env.cwd,
    configPath: env.configPath,
    defaultMux: env.defaultMux,
    defaultAgent: env.defaultAgent,
    selectedMuxRefSummary:
      selected === null ? null : summarizeMuxRef(selected.muxRef),
    relationship:
      selected === null ? null : relationshipView(selected, sessions),
  };
}
