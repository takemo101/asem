/**
 * Detail- and Context-tab projections for the selected Session.
 *
 * Both are pure mappings from a Session (plus, for Context, the resolved
 * {@link CockpitEnv}) to the fields the design lists under "Detail tabs". They
 * surface process/connection state and configuration only — never a work
 * outcome.
 */
import type { MuxRef, Session } from "@asem/core";
import type { CockpitEnv, ContextView, DetailView } from "./types.ts";

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
    id: session.id,
    name: session.name,
    status: session.status,
    agent: session.agent,
    mux: session.mux,
    model: session.model,
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

/**
 * Context-tab projection: scope identifiers, config path, and config-derived
 * defaults, plus the selected Session's mux-ref summary (null when no Session is
 * selected).
 */
export function contextView(
  env: CockpitEnv,
  selected: Session | null,
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
  };
}
