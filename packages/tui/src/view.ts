/**
 * Pure render projection: {@link CockpitState} → a structured {@link CockpitView}.
 *
 * This is the cockpit's "component" layer. It turns the view-model selectors into
 * a renderer-agnostic description of the screen — left-pane tree rows with status
 * symbols and ephemeral badges, the three detail tabs, the bottom keybar, and any
 * modal overlay — without touching a terminal. The terminal host paints a
 * {@link CockpitView}; tests assert on it directly, so layout behavior is covered
 * without fragile terminal snapshots (issue test guidance).
 */
import type { SessionStatus } from "@asem/core";
import { type ActivityItem, newSessionIds } from "./activity.ts";
import { timeLabel } from "./messages.ts";
import type {
  CockpitState,
  CockpitTab,
  MessageRow,
  SessionTreeNode,
} from "./types.ts";
import { COCKPIT_TABS } from "./types.ts";
import {
  badgeFor,
  contextTab,
  detailTab,
  messagesTab,
  selectedSession,
  sessionTree,
} from "./view-model.ts";

/** Status symbols for the left pane (design "Status symbols"). */
export const STATUS_SYMBOLS: Record<SessionStatus, string> = {
  starting: "…",
  running: "●",
  exited: "○",
  missing: "!",
  closed: "×",
};

/** Human titles for the right-pane tabs, in cycle order. */
export const TAB_TITLES: Record<CockpitTab, string> = {
  messages: "Messages",
  detail: "Detail",
  context: "Context",
};

/** One left-pane row: a worktree group header or a selectable Session. */
export type LeftRow =
  | { kind: "group"; worktreeRoot: string }
  | {
      kind: "session";
      sessionId: string;
      name: string;
      depth: number;
      status: SessionStatus;
      symbol: string;
      selected: boolean;
      /** Ephemeral new-incoming-message count (0 when none). */
      badge: number;
      /** True while the Session's `session_added` activity row is still live. */
      isNew: boolean;
    };

/** Left pane: header labels plus the flattened tree rows. */
export interface LeftPaneView {
  title: string;
  scopeLabel: string;
  filterLabel: string;
  rows: LeftRow[];
}

/** One tab header entry. */
export interface TabHeader {
  tab: CockpitTab;
  title: string;
  active: boolean;
}

/** A bottom-keybar affordance. */
export interface KeybarItem {
  key: string;
  label: string;
}

/** The active overlay rendered above the panes. */
export type ModalView =
  | { kind: "send"; title: string; lines: string[]; hint: string }
  | { kind: "confirm"; title: string; lines: string[]; hint: string }
  | { kind: "help"; title: string; lines: string[]; hint: string }
  | { kind: "error"; title: string; lines: string[]; hint: string };

/** Max body lines of the error dialog; longer messages are elided with `…`. */
export const ERROR_MODAL_MAX_LINES = 10;

/**
 * One activity-strip row: a time label, a formatted line, and a tone for
 * themed renderers (`add` for appearances, `warn` for status/delivery changes,
 * `remove` for removals, `info` otherwise).
 */
export interface ActivityRowView {
  timeLabel: string;
  text: string;
  tone: "add" | "remove" | "warn" | "info";
}

/**
 * One-line header content (design "Visual structure"): product, scope,
 * workspace id, and the auto-refresh state. Pure data — the renderer decides
 * styling.
 */
export interface HeaderView {
  product: string;
  scopeMode: CockpitState["env"]["scopeMode"];
  workspaceId: string;
  /** Refresh-state label, e.g. `auto 3s`. */
  autoLabel: string;
}

/** The full renderer-agnostic screen description. */
export interface CockpitView {
  header: HeaderView;
  left: LeftPaneView;
  tabs: TabHeader[];
  /** Rendered lines for the active tab. */
  right: string[];
  /** Recent in-memory activity rows, oldest first (empty when quiet). */
  activity: ActivityRowView[];
  keybar: KeybarItem[];
  modal: ModalView | null;
  /** Transient status / error line, or null. */
  statusLine: string | null;
}

/** The bottom keybar affordances (design layout). */
export const KEYBAR: readonly KeybarItem[] = [
  { key: "↑↓", label: "select" },
  { key: "Tab", label: "switch" },
  { key: "a", label: "attach" },
  { key: "s", label: "send" },
  { key: "c", label: "close" },
  { key: "D", label: "delete" },
  { key: "r", label: "refresh" },
  { key: "f", label: "filter" },
  { key: "?", label: "help" },
  { key: "q", label: "quit" },
];

/** Help-overlay body: every keybinding the cockpit supports. */
const HELP_LINES: readonly string[] = [
  "↑/k, ↓/j   select previous / next Session",
  "Tab        switch Messages / Detail / Context",
  "a          attach to the selected Session",
  "s          send a Message (Ctrl+Enter send, Esc cancel)",
  "c          close the selected Session",
  "D          delete the selected Session",
  "r          refresh",
  "f          cycle the status filter",
  "?          toggle this help",
  "q          quit",
];

function leftRows(state: CockpitState): LeftRow[] {
  const tree = sessionTree(state);
  const rows: LeftRow[] = [];
  const showGroups = tree.scopeMode === "workspace";
  const fresh = newSessionIds(state.activity);

  const walk = (nodes: SessionTreeNode[]): void => {
    for (const node of nodes) {
      rows.push({
        kind: "session",
        sessionId: node.session.id,
        name: node.session.name,
        depth: node.depth,
        status: node.session.status,
        symbol: STATUS_SYMBOLS[node.session.status],
        selected: node.session.id === state.selectedSessionId,
        badge: badgeFor(state, node.session.id),
        isNew: fresh.has(node.session.id),
      });
      walk(node.children);
    }
  };

  for (const group of tree.groups) {
    if (showGroups) {
      rows.push({ kind: "group", worktreeRoot: group.worktreeRoot });
    }
    walk(group.nodes);
  }
  return rows;
}

function messageLine(row: MessageRow): string {
  const base = `${row.timeLabel} ${row.fromLabel} → ${row.toLabel} [${row.kind}] ${row.message.body}`;
  return row.hasDeliveryError ? `${base} ! undelivered` : base;
}

function rightLines(state: CockpitState, attachHint: string | null): string[] {
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
      ];
    }
    default: {
      const _never: never = state.activeTab;
      return _never;
    }
  }
}

/** Format one activity item into a themed activity-strip row. */
export function activityRow(item: ActivityItem): ActivityRowView {
  switch (item.kind) {
    case "session_added":
      return {
        timeLabel: timeLabel(item.at),
        text: `+ ${item.worktreeRoot} new Session ${item.sessionName}`,
        tone: "add",
      };
    case "session_removed":
      return {
        timeLabel: timeLabel(item.at),
        text: `- ${item.worktreeRoot} removed Session ${item.sessionName}`,
        tone: "remove",
      };
    case "status_changed":
      return {
        timeLabel: timeLabel(item.at),
        text: `! ${item.worktreeRoot} ${item.sessionName} ${item.from} → ${item.to}`,
        tone: "warn",
      };
    case "message_added":
      return {
        timeLabel: timeLabel(item.at),
        text: `+ ${item.fromLabel} → ${item.toLabel} [${item.messageKind}]`,
        tone: "add",
      };
    case "delivery_changed":
      return {
        timeLabel: timeLabel(item.at),
        text:
          item.result === "error"
            ? `! delivery to ${item.toLabel} failed: ${item.deliveryError ?? "unknown"}`
            : `· delivery to ${item.toLabel} ${item.result}`,
        tone: item.result === "error" ? "warn" : "info",
      };
    default: {
      const _never: never = item;
      return _never;
    }
  }
}

function modalView(state: CockpitState): ModalView | null {
  switch (state.modal.kind) {
    case "none":
      return null;
    case "send": {
      const selected = selectedSession(state);
      const target = selected === null ? "Session" : selected.name;
      return {
        kind: "send",
        title: `Send Message to ${target}`,
        lines: state.modal.draft.split("\n"),
        hint: "Ctrl+Enter send · Enter newline · Esc cancel",
      };
    }
    case "confirm": {
      const { action, sessionId } = state.modal;
      const label =
        state.snapshot.sessions.find((s) => s.id === sessionId)?.name ??
        sessionId;
      const verb = action === "close" ? "Close" : "Delete";
      return {
        kind: "confirm",
        title: `${verb} Session`,
        lines: [
          `${verb} ${label}?`,
          action === "delete"
            ? "This also removes its related Messages."
            : "Its pane/process will be closed.",
        ],
        hint: "y confirm · n cancel",
      };
    }
    case "help":
      return {
        kind: "help",
        title: "Keybindings",
        lines: [...HELP_LINES],
        hint: "? or Esc to close",
      };
    case "error": {
      const lines = [
        `code: ${state.modal.code}`,
        ...state.modal.message.split("\n"),
      ];
      const capped =
        lines.length > ERROR_MODAL_MAX_LINES
          ? [...lines.slice(0, ERROR_MODAL_MAX_LINES - 1), "…"]
          : lines;
      return {
        kind: "error",
        title: "Operation failed",
        lines: capped,
        hint: "Esc to dismiss",
      };
    }
    default: {
      const _never: never = state.modal;
      return _never;
    }
  }
}

/**
 * Project the current cockpit state into a renderable {@link CockpitView}.
 *
 * `attachHint` (from `get_session`) is woven into the Detail tab when known;
 * `statusLine` carries a transient host message (e.g. the last operation error)
 * for the host to surface; `autoRefreshMs` feeds the header's refresh-state
 * label. All default to absent.
 */
export function renderCockpitView(
  state: CockpitState,
  options: {
    attachHint?: string | null;
    statusLine?: string | null;
    autoRefreshMs?: number;
  } = {},
): CockpitView {
  return {
    header: {
      product: "asem",
      scopeMode: state.env.scopeMode,
      workspaceId: state.env.workspaceId,
      autoLabel:
        options.autoRefreshMs === undefined
          ? "auto off"
          : `auto ${options.autoRefreshMs / 1000}s`,
    },
    left: {
      title: "Sessions",
      scopeLabel: `scope: ${state.env.scopeMode}`,
      filterLabel: `filter: ${state.filter}`,
      rows: leftRows(state),
    },
    tabs: COCKPIT_TABS.map((tab) => ({
      tab,
      title: TAB_TITLES[tab],
      active: tab === state.activeTab,
    })),
    right: rightLines(state, options.attachHint ?? null),
    activity: state.activity.map(activityRow),
    keybar: [...KEYBAR],
    modal: modalView(state),
    statusLine: options.statusLine ?? null,
  };
}
