/**
 * Left `Sessions` panel: worktree group headers (workspace scope) and themed
 * Session rows with status glyph/color, selection marker, ephemeral badge, and
 * new-Session marker — all read from the pure {@link LeftPaneView} rows.
 */
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import type { KeyEvent } from "../../keymap.ts";
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

export function rowElementId(row: LeftRow): string {
  return row.kind === "group"
    ? `session-list-group:${row.worktreeRoot}`
    : `session-list-row:${row.sessionId}`;
}

export function selectedRowElementId(rows: LeftRow[]): string | null {
  const selected = rows.find((row) => row.kind === "session" && row.selected);
  return selected === undefined ? null : rowElementId(selected);
}

export function selectedSessionId(rows: LeftRow[]): string | null {
  const selected = rows.find((row) => row.kind === "session" && row.selected);
  return selected?.kind === "session" ? selected.sessionId : null;
}

export function desiredSessionListScrollTop(
  rows: LeftRow[],
  sessionId: string,
  currentScrollTop: number,
  viewportRows: number,
): number {
  const selectedIndex = rows.findIndex(
    (row) => row.kind === "session" && row.sessionId === sessionId,
  );
  if (selectedIndex < 0) {
    return currentScrollTop;
  }

  const visibleRows = Math.max(1, viewportRows);
  const maxScrollTop = Math.max(0, rows.length - visibleRows);
  const current = Math.min(Math.max(0, currentScrollTop), maxScrollTop);

  if (selectedIndex < current) {
    return selectedIndex;
  }
  if (selectedIndex >= current + visibleRows) {
    return Math.min(selectedIndex - visibleRows + 1, maxScrollTop);
  }
  return current;
}

export function scrollDirectionToSelectionKey(
  direction: MouseEvent["scroll"] extends { direction: infer Direction }
    ? Direction
    : string | undefined,
): KeyEvent | null {
  switch (direction) {
    case "down":
      return { key: "down" };
    case "up":
      return { key: "up" };
    default:
      return null;
  }
}

export function SessionRowsScrollBox(props: {
  rows: LeftRow[];
  bodyRows: number;
  scrollRef?: Ref<ScrollBoxRenderable>;
  onScrollSelection?: (event: KeyEvent) => void;
}): ReactNode {
  return (
    <scrollbox
      ref={props.scrollRef}
      scrollY={true}
      scrollX={false}
      height={props.bodyRows}
      flexGrow={1}
      minHeight={0}
      viewportOptions={{ backgroundColor: theme.panel }}
      contentOptions={{ flexDirection: "column", width: "100%" }}
      onMouseScroll={(event) => {
        const key = scrollDirectionToSelectionKey(event.scroll?.direction);
        if (key !== null) {
          props.onScrollSelection?.(key);
        }
      }}
    >
      {props.rows.map((row, index) => {
        const key =
          row.kind === "group" ? `g:${row.worktreeRoot}` : row.sessionId;
        return (
          <box
            key={key}
            id={rowElementId(row)}
            backgroundColor={rowBackground(row, index)}
            height={1}
            overflow="hidden"
            width="100%"
          >
            <text
              fg={rowColor(row)}
              height={1}
              truncate={true}
              width="100%"
              wrapMode="none"
            >
              {rowText(row)}
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
}

export function SessionList(props: {
  left: LeftPaneView;
  maxVisibleRows: number;
  width: number;
  onScrollSelection?: (event: KeyEvent) => void;
}): ReactNode {
  const { left } = props;
  const bodyRows = Math.max(1, props.maxVisibleRows - 1);
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = selectedSessionId(left.rows);

  useEffect(() => {
    const scrollbox = scrollboxRef.current;
    if (scrollbox === null || selectedId === null) {
      return;
    }
    const nextScrollTop = desiredSessionListScrollTop(
      left.rows,
      selectedId,
      scrollbox.scrollTop,
      bodyRows,
    );
    if (nextScrollTop !== scrollbox.scrollTop) {
      scrollbox.scrollTo(nextScrollTop);
    }
  }, [bodyRows, left.rows, selectedId]);
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
        <SessionRowsScrollBox
          rows={left.rows}
          bodyRows={bodyRows}
          scrollRef={scrollboxRef}
          onScrollSelection={props.onScrollSelection}
        />
      )}
    </box>
  );
}
