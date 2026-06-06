/**
 * View-model types for the OpenTUI Session cockpit (`@asem/tui`).
 *
 * These describe the *projection* the cockpit renders, not the terminal widgets
 * themselves. The view-model is a pure, testable layer over `@asem/ops` results:
 * it never owns SQLite, a multiplexer, an agent, or a real terminal. Everything
 * here is derived from a {@link CockpitSnapshot} plus ephemeral interaction state
 * (selection, tab, filter, modal, and a new-message baseline) — and the baseline
 * is the only "unread"-shaped concept, deliberately kept in memory so no durable
 * read/unread state is ever persisted (CONTEXT.md "Inbox"; design "TUI behavior").
 */
import type { Message, MessageKind, Session, SessionStatus } from "@asem/core";

/**
 * Cockpit scope. `worktree` (default) shows only the current
 * `workspace_id + worktree_root`; `workspace` shows every Session sharing the
 * `workspace_id`, grouped by `worktree_root` before the tree is drawn (design
 * "Scope resolution").
 */
export type CockpitScopeMode = "worktree" | "workspace";

/** The three right-pane tabs for the selected Session. Messages is default. */
export type CockpitTab = "messages" | "detail" | "context";

/** Tab cycle order for `Tab` switching. */
export const COCKPIT_TABS: readonly CockpitTab[] = [
  "messages",
  "detail",
  "context",
];

/**
 * Left-pane status filter. `"all"` disables the filter; the remaining values are
 * the {@link SessionStatus} process states. Cycled with the `filter` action.
 */
export type CockpitStatusFilter = "all" | SessionStatus;

/** Filter cycle order for the `filter` action. */
export const COCKPIT_FILTERS: readonly CockpitStatusFilter[] = [
  "all",
  "starting",
  "running",
  "exited",
  "missing",
  "closed",
];

/**
 * Immutable inputs to the cockpit that come from the resolved project context
 * rather than the Session/Message rows: scope, identifiers, and config-derived
 * defaults shown on the Context tab.
 */
export interface CockpitEnv {
  scopeMode: CockpitScopeMode;
  workspaceId: string;
  /** The current worktree root; the sole group in `worktree` scope. */
  worktreeRoot: string;
  cwd: string;
  configPath: string;
  defaultMux: string;
  defaultAgent: string;
}

/** The raw store projection the cockpit renders from. */
export interface CockpitSnapshot {
  sessions: Session[];
  messages: Message[];
}

// --- Session tree ---------------------------------------------------------

/** One node in the left-pane Session tree. */
export interface SessionTreeNode {
  session: Session;
  /** Indentation depth; 0 for a node with no in-scope parent. */
  depth: number;
  children: SessionTreeNode[];
}

/**
 * A `worktree_root` grouping of top-level tree nodes. In `worktree` scope there
 * is exactly one group; in `workspace` scope there is one per distinct
 * `worktree_root`, and parent-child links never cross a group (worktree
 * isolation — CONTEXT.md).
 */
export interface WorktreeGroup {
  worktreeRoot: string;
  nodes: SessionTreeNode[];
}

/** The full left-pane tree: grouped roots plus the scope it was built for. */
export interface SessionTree {
  scopeMode: CockpitScopeMode;
  groups: WorktreeGroup[];
}

/** A flattened, selectable row in the rendered tree (pre-order traversal). */
export interface VisibleSessionRow {
  session: Session;
  depth: number;
  worktreeRoot: string;
}

// --- Tab projections ------------------------------------------------------

/** One row on the Messages tab for the selected Session. */
export interface MessageRow {
  message: Message;
  /** `HH:MM` taken verbatim from the stored ISO timestamp (no tz math). */
  timeLabel: string;
  /** Sender label: the Session name, its id, or `external` for human sends. */
  fromLabel: string;
  /** Recipient label: the Session name or its id. */
  toLabel: string;
  kind: MessageKind;
  /** True once `delivered_at` is set. */
  delivered: boolean;
  /** Best-effort delivery failure text, or null. */
  deliveryError: string | null;
  /** True when a delivery error is recorded — the `! undelivered` marker. */
  hasDeliveryError: boolean;
}

/** Detail-tab projection of the selected Session. */
export interface DetailView {
  id: string;
  name: string;
  status: SessionStatus;
  agent: string;
  mux: string;
  /** Parent Session name if resolvable in scope, else its id, else `-`. */
  parentLabel: string;
  parentSessionId: string | null;
  cwd: string;
  worktreeRoot: string;
  sessionDir: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Operator attach hint; filled by the host from `get_session` when known. */
  attachHint: string | null;
}

/** Context-tab projection: scope + config defaults + selected mux ref. */
export interface ContextView {
  workspaceId: string;
  worktreeRoot: string;
  cwd: string;
  configPath: string;
  defaultMux: string;
  defaultAgent: string;
  /** `key=value` summary of the selected Session's mux ref, or null. */
  selectedMuxRefSummary: string | null;
}

// --- Modal / interaction state -------------------------------------------

/**
 * The active overlay. `send` carries the textarea draft; `confirm` carries the
 * destructive action awaiting confirmation (design: close/delete need a
 * confirmation dialog).
 */
export type CockpitModal =
  | { kind: "none" }
  | { kind: "help" }
  | { kind: "send"; draft: string }
  | { kind: "confirm"; action: "close" | "delete"; sessionId: string };

// --- Actions & effects ----------------------------------------------------

/**
 * Operator intents dispatched into the pure reducer. Navigation, tab/filter,
 * the send modal, and the close/delete confirmation flow are all modeled here so
 * the same transitions can be tested without a terminal.
 */
export type CockpitAction =
  | { type: "selectNext" }
  | { type: "selectPrev" }
  | { type: "select"; sessionId: string }
  | { type: "switchTab" }
  | { type: "setTab"; tab: CockpitTab }
  | { type: "cycleFilter" }
  | { type: "setFilter"; filter: CockpitStatusFilter }
  | { type: "refresh" }
  | { type: "attach" }
  | { type: "openSend" }
  | { type: "updateDraft"; draft: string }
  | { type: "submitSend" }
  | { type: "cancelModal" }
  | { type: "requestClose" }
  | { type: "requestDelete" }
  | { type: "confirm" }
  | { type: "toggleHelp" }
  | { type: "quit" };

/**
 * Side-effect intents the reducer asks the host to carry out. The view-model
 * never performs I/O itself; the host maps these to `@asem/ops` calls (send /
 * close / delete / refresh) or to local actions (attach / quit). Crucially, a
 * `close`/`delete` effect is only ever emitted after a `confirm`.
 */
export type CockpitEffect =
  | { kind: "attach"; sessionId: string }
  | { kind: "send"; sessionId: string; body: string }
  | { kind: "close"; sessionId: string }
  | { kind: "delete"; sessionId: string }
  | { kind: "refresh" }
  | { kind: "quit" };

/** Result of dispatching an action: the next state and an optional effect. */
export interface CockpitDispatchResult {
  state: CockpitState;
  effect?: CockpitEffect;
}

// --- Cockpit state --------------------------------------------------------

/**
 * The complete cockpit view-model state. `baseline` holds the ids of incoming
 * Messages already observed; new-message badges are derived from it and it lives
 * only here — never written back to the store (design: "New-message badges are
 * ephemeral, based on TUI start / last observed baseline").
 */
export interface CockpitState {
  env: CockpitEnv;
  snapshot: CockpitSnapshot;
  filter: CockpitStatusFilter;
  selectedSessionId: string | null;
  activeTab: CockpitTab;
  baseline: ReadonlySet<string>;
  modal: CockpitModal;
}
