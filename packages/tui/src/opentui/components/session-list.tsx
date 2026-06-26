/**
 * Left `Sessions` panel: worktree group headers (workspace scope) and themed
 * Session rows with status glyph/color, selection marker, ephemeral badge, and
 * new-Session marker — all read from the pure {@link LeftPaneView} rows.
 */
import type { ReactNode } from "react";
import type { LeftPaneView, LeftRow } from "../../view.ts";
import { statusAccent, theme } from "../theme.ts";

export const SESSION_LIST_MIN_WIDTH = 36;
export const SESSION_LIST_MAX_WIDTH = 56;
const SESSION_LIST_WIDTH_RATIO = 0.32;

export function sessionListWidthForTerminal(totalWidth: number): number {
  const proportional = Math.floor(totalWidth * SESSION_LIST_WIDTH_RATIO);
  return Math.min(
    SESSION_LIST_MAX_WIDTH,
    Math.max(SESSION_LIST_MIN_WIDTH, proportional),
  );
}

/** Window a list around the selected index so the selection stays visible. */
export function listWindow(
  length: number,
  selectedIndex: number,
  maxVisible: number,
): { start: number; end: number } {
  if (length <= maxVisible || maxVisible <= 0) {
    return { start: 0, end: length };
  }
  const half = Math.floor(maxVisible / 2);
  const start = Math.min(
    Math.max(0, selectedIndex - half),
    length - maxVisible,
  );
  return { start, end: start + maxVisible };
}

/** Compact location label (the worktree root's last path segment). */
export function locationBadge(worktreeRoot: string): string {
  const segments = worktreeRoot.split("/").filter((s) => s.length > 0);
  return segments.at(-1) ?? worktreeRoot;
}

/** Render one row's text (pure; exported for tests). */
export function rowText(row: LeftRow): string {
  if (row.kind === "group") {
    return `▾ ${row.worktreeRoot}`;
  }
  const cursor = row.selected ? "› " : "  ";
  const indent = "  ".repeat(row.depth);
  const badge = row.badge > 0 ? ` +${row.badge}` : "";
  const marker = row.isNew ? " *" : "";
  const where = ` @${locationBadge(row.location)}`;
  return `${cursor}${indent}${row.symbol} ${row.name}${badge}${marker}${where}`;
}

function rowColor(row: LeftRow): string {
  if (row.kind === "group") {
    return theme.purple;
  }
  return row.selected ? theme.strong : statusAccent(row.status);
}

function rowBackground(row: LeftRow, index: number): string {
  if (row.kind === "session" && row.selected) {
    return theme.rowSelected;
  }
  return index % 2 === 0 ? theme.rowAlt : theme.row;
}

export function SessionList(props: {
  left: LeftPaneView;
  maxVisibleRows: number;
  width: number;
}): ReactNode {
  const { left } = props;
  const selectedIndex = left.rows.findIndex(
    (row) => row.kind === "session" && row.selected,
  );
  const { start, end } = listWindow(
    left.rows.length,
    Math.max(0, selectedIndex),
    Math.max(1, props.maxVisibleRows),
  );
  const visible = left.rows.slice(start, end);
  return (
    <box
      title={left.title}
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.panel}
      width={props.width}
      flexShrink={0}
      flexDirection="column"
      minHeight={0}
      paddingX={1}
    >
      <box backgroundColor={theme.panelAlt} height={1}>
        <text
          fg={theme.muted}
        >{`${left.scopeLabel} · ${left.filterLabel}`}</text>
      </box>
      {left.rows.length === 0 ? (
        <text fg={theme.muted}>No Sessions in scope.</text>
      ) : (
        visible.map((row, visibleIndex) => {
          const index = start + visibleIndex;
          const key =
            row.kind === "group" ? `g:${row.worktreeRoot}` : row.sessionId;
          return (
            <box
              key={key}
              backgroundColor={rowBackground(row, index)}
              height={1}
            >
              <text fg={rowColor(row)}>{rowText(row)}</text>
            </box>
          );
        })
      )}
      {end < left.rows.length ? (
        <text fg={theme.muted}>{`… ${left.rows.length - end} more`}</text>
      ) : null}
    </box>
  );
}
