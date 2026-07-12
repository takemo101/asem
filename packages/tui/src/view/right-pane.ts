/**
 * Right-pane projection: the active tab (Messages / Detail / Context) →
 * rendered text lines. One of the cockpit's render projections (see
 * `../view.ts`). Reads the pure tab selectors; never touches a terminal.
 */
import { MESSAGE_FAILED_NOTICE } from "../messages.ts";
import type { CockpitState, MessageRow, RelationshipView } from "../types.ts";
import { contextTab, detailTab, messagesTab } from "../view-model.ts";

/** Restrained rule separating timeline ledger entries. */
export const TIMELINE_RULE = "────────";

/** Calm-terminal tone of one timeline ledger line (spec "Goal"). */
export type TimelineTone = "in" | "out" | "failure";

/**
 * Classify a rendered Messages-tab line for the calm-terminal treatment:
 * green incoming headers, amber outgoing headers, red only for the durable
 * failed-notification notice. Body, preview, and rule lines carry no tone.
 */
export function timelineLineTone(line: string): TimelineTone | null {
  if (line === `  ${MESSAGE_FAILED_NOTICE}`) {
    return "failure";
  }
  if (/^\S+ IN {2}/.test(line)) {
    return "in";
  }
  if (/^\S+ OUT /.test(line)) {
    return "out";
  }
  return null;
}

/**
 * One timeline ledger entry (spec "Messages"): a `time direction kind ·
 * counterpart` header, then the expanded body or a one-line preview, then the
 * durable failed-notification notice when delivery failed.
 */
function ledgerEntryLines(row: MessageRow): string[] {
  const direction = row.direction === "in" ? "IN " : "OUT";
  const lines = [
    `${row.timeLabel} ${direction} ${row.kind} · ${row.counterpartLabel}`,
  ];
  if (row.expanded) {
    for (const bodyLine of row.message.body.split("\n")) {
      lines.push(`  ${bodyLine}`);
    }
  } else {
    lines.push(`  ${row.previewLabel}`);
  }
  if (row.failedNoticeLabel !== null) {
    lines.push(`  ${row.failedNoticeLabel}`);
  }
  return lines;
}

/** Chronological timeline ledger with rules between entries. */
function ledgerLines(rows: MessageRow[]): string[] {
  const lines: string[] = [];
  rows.forEach((row, index) => {
    if (index > 0) {
      lines.push(TIMELINE_RULE);
    }
    lines.push(...ledgerEntryLines(row));
  });
  return lines;
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
 * Render the read-first relationship card for the Context tab, ordered parent
 * → selected → children (spec "Context"). A placeholder when no Session is
 * selected. Deliberately free of inline action hints: attach/send/close/delete
 * stay on the global keybar.
 */
function relationshipLines(relationship: RelationshipView | null): string[] {
  if (relationship === null) {
    return ["Relationship", "  (no Session selected)"];
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
  const children =
    relationship.children.length === 0
      ? "-"
      : relationship.children.map(refLine).join(", ");
  return [
    "Relationship",
    `  parent:    ${parent}`,
    `  selected:  ${refLine(relationship.selected)}`,
    `  children:  ${children}`,
    `  scope:     ${relationship.scopeNote}`,
  ];
}

/**
 * Presentation options for {@link rightLines}. The expansion options override
 * the state's own ephemeral expansion fields when provided; by default the
 * runtime renders straight from {@link CockpitState}.
 */
export interface RightPaneOptions {
  /** Operator attach hint woven into the Detail tab when known. */
  attachHint?: string | null;
  /** Ephemeral ids of ordinary Messages expanded through local UI state. */
  expandedMessageIds?: ReadonlySet<string>;
  /** Ephemeral flag expanding the Detail tab's Technical section. */
  technicalExpanded?: boolean;
}

/** Render the active tab's body lines. */
export function rightLines(
  state: CockpitState,
  options: RightPaneOptions = {},
): string[] {
  const attachHint = options.attachHint ?? null;
  switch (state.activeTab) {
    case "messages": {
      const rows = messagesTab(state, {
        ...(options.expandedMessageIds === undefined
          ? {}
          : { expandedMessageIds: options.expandedMessageIds }),
      });
      return rows.length === 0 ? ["(no messages)"] : ledgerLines(rows);
    }
    case "detail": {
      const detail = detailTab(state, attachHint);
      if (detail === null) {
        return ["(no Session selected)"];
      }
      // Operational summary ordered for ordinary operator decisions (spec
      // "Detail"): identity/process first, then location, then lifecycle,
      // with the technical coordinates collapsed by default.
      const technical =
        (options.technicalExpanded ?? state.technicalExpanded)
          ? [
              "Technical",
              `  id:            ${detail.id}`,
              `  session_dir:   ${detail.sessionDir}`,
              `  mux_ref:       ${detail.muxRefSummary}`,
              `  attach_hint:   ${detail.attachHint ?? "-"}`,
            ]
          : ["Technical ▸ id · session dir · mux ref · attach hint"];
      return [
        "Session",
        `  status:        ${detail.status}`,
        `  name:          ${detail.name}`,
        `  agent:         ${detail.agent}`,
        `  mux:           ${detail.mux}`,
        `  model:         ${detail.model ?? "-"}`,
        // Profile metadata appears only when the Session was created with one
        // (MIK-041), keeping the common no-profile detail view uncluttered.
        ...(detail.profile !== null
          ? [
              `  profile:       ${detail.profile}${
                detail.profileSource === null
                  ? ""
                  : ` (${detail.profileSource})`
              }`,
            ]
          : []),
        `  parent:        ${detail.parentLabel}`,
        "",
        "Location",
        `  cwd:           ${detail.cwd}`,
        `  worktree_root: ${detail.worktreeRoot}`,
        "",
        "Lifecycle",
        `  created_at:    ${detail.createdAt}`,
        `  updated_at:    ${detail.updatedAt}`,
        `  closed_at:     ${detail.closedAt ?? "-"}`,
        "",
        ...technical,
      ];
    }
    case "context": {
      const ctx = contextTab(state);
      // Read-first relationship card first; Workspace and location metadata
      // in a separate section (spec "Context").
      return [
        ...relationshipLines(ctx.relationship),
        "",
        "Workspace",
        `  workspace_id:  ${ctx.workspaceId}`,
        `  worktree_root: ${ctx.worktreeRoot}`,
        `  cwd:           ${ctx.cwd}`,
        `  config:        ${ctx.configPath}`,
        `  default_mux:   ${ctx.defaultMux}`,
        `  default_agent: ${ctx.defaultAgent}`,
        `  mux_ref:       ${ctx.selectedMuxRefSummary ?? "-"}`,
      ];
    }
    default: {
      const _never: never = state.activeTab;
      return _never;
    }
  }
}
