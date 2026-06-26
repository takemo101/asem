/**
 * Pure render projection: {@link CockpitState} → a structured {@link CockpitView}.
 *
 * This is the cockpit's "component" layer. It turns the view-model selectors into
 * a renderer-agnostic description of the screen — left-pane tree rows with status
 * symbols and ephemeral badges, the three detail tabs, the bottom keybar, and any
 * modal overlay — without touching a terminal. The terminal host paints a
 * {@link CockpitView}; tests assert on it directly, so layout behavior is covered
 * without fragile terminal snapshots (issue test guidance).
 *
 * `renderCockpitView` is the composition root; the larger projections live in
 * focused sibling modules under `./view/` (modal overlay, activity strip, right
 * pane) so each shape can change in isolation.
 */
import type { SessionStatus } from "@asem/core";
import { newSessionIds } from "./activity.ts";
import type { CockpitState, CockpitTab, SessionTreeNode } from "./types.ts";
import { COCKPIT_TABS } from "./types.ts";
import { type ActivityRowView, activityRow } from "./view/activity-row.ts";
import { type ModalView, modalView } from "./view/modal.ts";
import { rightLines } from "./view/right-pane.ts";
import { badgeFor, sessionTree } from "./view-model.ts";

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

/**
 * One left-pane row: a worktree group header or a selectable Session.
 *
 * Group headers are no longer emitted by the Workspace tree projection (ADR
 * 0008 makes the Workspace a single parent-child tree with per-row location
 * badges); the `group` variant is retained for the renderer's row formatter.
 */
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
      /**
       * The Session's own `worktree_root` location, for a repo/location badge
       * so root vs repo Sessions stay distinguishable in the Workspace tree.
       */
      location: string;
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

/**
 * Transient, renderer-neutral cockpit feedback. Distinct from a Message,
 * Report, Activity row, durable event, or unread state — it is the cockpit's
 * own ephemeral "what just happened" signal, projected per-renderer (OpenTUI
 * toast, ANSI footer text).
 */
export type CockpitNotice =
  | { level: "success"; message: string }
  | { level: "info"; message: string }
  | { level: "error"; message: string; code: string };

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
  /** Transient renderer-neutral cockpit feedback, or null. */
  notice: CockpitNotice | null;
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

function leftRows(state: CockpitState): LeftRow[] {
  const tree = sessionTree(state);
  const rows: LeftRow[] = [];
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
        location: node.session.worktreeRoot,
      });
      walk(node.children);
    }
  };

  // One Workspace parent-child tree; location rides on each row as a badge
  // rather than as worktree group headers (design "Global tree + repo badges").
  for (const group of tree.groups) {
    walk(group.nodes);
  }
  return rows;
}

/**
 * Project the current cockpit state into a renderable {@link CockpitView}.
 *
 * `attachHint` (from `get_session`) is woven into the Detail tab when known;
 * `notice` carries transient cockpit feedback (e.g. the last operation outcome)
 * for the host to surface; `autoRefreshMs` feeds the header's refresh-state
 * label. All default to absent.
 */
export function renderCockpitView(
  state: CockpitState,
  options: {
    attachHint?: string | null;
    notice?: CockpitNotice | null;
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
    notice: options.notice ?? null,
  };
}
