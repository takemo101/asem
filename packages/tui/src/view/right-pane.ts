/**
 * Right-pane projection: the active tab (Messages / Detail / Context) →
 * rendered text lines. One of the cockpit's render projections (see
 * `../view.ts`). Reads the pure tab selectors; never touches a terminal.
 */
import type { CockpitState, MessageRow, RelationshipView } from "../types.ts";
import { contextTab, detailTab, messagesTab } from "../view-model.ts";

function messageLine(row: MessageRow): string {
  const base = `${row.timeLabel} ${row.fromLabel} → ${row.toLabel} [${row.kind}] ${row.message.body}`;
  return row.hasDeliveryError ? `${base} ! undelivered` : base;
}

/** A related Session as `name (id) @location`, with graceful fallbacks. */
function refLine(ref: {
  id: string;
  name: string | null;
  location: string | null;
}): string {
  const name = ref.name ?? ref.id;
  const where = ref.location === null ? "" : ` @${ref.location}`;
  return `${name} (${ref.id})${where}`;
}

/**
 * Render the Workspace relationship card for the Context tab (design
 * "Relationship card in Context tab"). Empty when no Session is selected.
 */
function relationshipLines(relationship: RelationshipView | null): string[] {
  if (relationship === null) {
    return [];
  }
  const parent =
    relationship.parent === null
      ? relationship.parentSessionId === null
        ? "- (Workspace root)"
        : refLine({
            id: relationship.parentSessionId,
            name: null,
            location: null,
          })
      : refLine(relationship.parent);
  const siblings =
    relationship.siblings.length === 0
      ? "-"
      : relationship.siblings.map(refLine).join(", ");
  return [
    "",
    "relationship:",
    `  parent:      ${parent}`,
    `  location:    ${relationship.location}`,
    `  siblings:    ${siblings}`,
    `  scope:       ${relationship.scopeNote}`,
  ];
}

/** Render the active tab's body lines, weaving in `attachHint` on the Detail tab. */
export function rightLines(
  state: CockpitState,
  attachHint: string | null,
): string[] {
  switch (state.activeTab) {
    case "messages": {
      const rows = messagesTab(state);
      return rows.length === 0 ? ["(no messages)"] : rows.map(messageLine);
    }
    case "detail": {
      const detail = detailTab(state, attachHint);
      if (detail === null) {
        return ["(no Session selected)"];
      }
      return [
        `id:            ${detail.id}`,
        `name:          ${detail.name}`,
        `status:        ${detail.status}`,
        `agent:         ${detail.agent}`,
        `mux:           ${detail.mux}`,
        `model:         ${detail.model ?? "-"}`,
        // Profile metadata appears only when the Session was created with one
        // (MIK-041), keeping the common no-profile detail view uncluttered.
        ...(detail.profile !== null
          ? [
              `profile:       ${detail.profile}`,
              `profile_src:   ${detail.profileSource ?? "-"}`,
            ]
          : []),
        `parent:        ${detail.parentLabel}`,
        `cwd:           ${detail.cwd}`,
        `worktree_root: ${detail.worktreeRoot}`,
        `session_dir:   ${detail.sessionDir}`,
        `created_at:    ${detail.createdAt}`,
        `updated_at:    ${detail.updatedAt}`,
        `closed_at:     ${detail.closedAt ?? "-"}`,
        `attach_hint:   ${detail.attachHint ?? "-"}`,
      ];
    }
    case "context": {
      const ctx = contextTab(state);
      return [
        `workspace_id:  ${ctx.workspaceId}`,
        `worktree_root: ${ctx.worktreeRoot}`,
        `cwd:           ${ctx.cwd}`,
        `config:        ${ctx.configPath}`,
        `default_mux:   ${ctx.defaultMux}`,
        `default_agent: ${ctx.defaultAgent}`,
        `mux_ref:       ${ctx.selectedMuxRefSummary ?? "-"}`,
        ...relationshipLines(ctx.relationship),
      ];
    }
    default: {
      const _never: never = state.activeTab;
      return _never;
    }
  }
}
