/**
 * The cockpit view-model: state construction, pure selectors, and the action
 * reducer.
 *
 * This is the functional core of `@asem/tui`. It holds no I/O. The host renders
 * from the selectors, feeds operator input through {@link dispatchCockpit}, and
 * carries out the returned {@link CockpitEffect} against `@asem/ops`. Destructive
 * effects (`close`/`delete`) are only ever emitted after a `confirm`, satisfying
 * the design's confirmation requirement. The new-message baseline lives only in
 * state, so badges never become durable read/unread state.
 */
import type { Session } from "@asem/core";
import {
  badgeCount as badgeCountFor,
  messageRows,
  observeSession,
  seedBaseline,
} from "./messages.ts";
import { contextView, detailView } from "./tabs.ts";
import { buildSessionTree, filterSessions, flattenTree } from "./tree.ts";
import {
  COCKPIT_FILTERS,
  COCKPIT_TABS,
  type CockpitAction,
  type CockpitDispatchResult,
  type CockpitEffect,
  type CockpitEnv,
  type CockpitSnapshot,
  type CockpitState,
  type CockpitStatusFilter,
  type CockpitTab,
  type ContextView,
  type DetailView,
  type MessageRow,
  type SessionTree,
  type VisibleSessionRow,
} from "./types.ts";

// --- State construction ---------------------------------------------------

export interface CreateCockpitStateOptions {
  /**
   * Explicit observed baseline. Defaults to every Message id in the snapshot, so
   * nothing is badged as new at TUI start. Pass `[]` to treat all existing
   * Messages as new (useful in tests).
   */
  baseline?: Iterable<string>;
  /** Initial tab; defaults to Messages (the design's default tab). */
  activeTab?: CockpitTab;
  /** Initial status filter; defaults to `"all"`. */
  filter?: CockpitStatusFilter;
}

/**
 * Create the initial cockpit state for an environment and snapshot. Selection
 * defaults to the first visible Session; if the Messages tab is active, that
 * Session is immediately observed so it opens without a stale badge.
 */
export function createCockpitState(
  env: CockpitEnv,
  snapshot: CockpitSnapshot,
  options: CreateCockpitStateOptions = {},
): CockpitState {
  const baseline: ReadonlySet<string> =
    options.baseline === undefined
      ? seedBaseline(snapshot.messages)
      : new Set(options.baseline);

  const filter = options.filter ?? "all";
  const activeTab = options.activeTab ?? "messages";

  const draft: CockpitState = {
    env,
    snapshot,
    filter,
    selectedSessionId: null,
    activeTab,
    baseline,
    modal: { kind: "none" },
  };

  const first = visibleSessionRows(draft)[0];
  draft.selectedSessionId = first?.session.id ?? null;
  return observeIfViewingMessages(draft);
}

/**
 * Replace the snapshot (e.g. after a refresh), preserving the selected Session
 * when it still exists and otherwise falling back to the first visible row. The
 * baseline is preserved so Messages that arrived since the last observation
 * still surface as new — except for the Session currently open on the Messages
 * tab, which is re-observed so the row you are reading never accrues a badge.
 */
export function applySnapshot(
  state: CockpitState,
  snapshot: CockpitSnapshot,
): CockpitState {
  const next: CockpitState = { ...state, snapshot };
  const rows = visibleSessionRows(next);
  const stillVisible =
    next.selectedSessionId !== null &&
    rows.some((r) => r.session.id === next.selectedSessionId);
  if (!stillVisible) {
    next.selectedSessionId = rows[0]?.session.id ?? null;
  }
  return observeIfViewingMessages(next);
}

// --- Selectors ------------------------------------------------------------

/** The left-pane tree for the current snapshot, scope, and filter. */
export function sessionTree(state: CockpitState): SessionTree {
  const filtered = filterSessions(state.snapshot.sessions, state.filter);
  return buildSessionTree(
    filtered,
    state.env.scopeMode,
    state.env.worktreeRoot,
  );
}

/** The flattened, selectable rows of the current tree, in render order. */
export function visibleSessionRows(state: CockpitState): VisibleSessionRow[] {
  return flattenTree(sessionTree(state));
}

/** The selected Session, or null when nothing is selected / visible. */
export function selectedSession(state: CockpitState): Session | null {
  if (state.selectedSessionId === null) {
    return null;
  }
  return (
    state.snapshot.sessions.find((s) => s.id === state.selectedSessionId) ??
    null
  );
}

/** Messages-tab rows for the selected Session (empty when none selected). */
export function messagesTab(state: CockpitState): MessageRow[] {
  if (state.selectedSessionId === null) {
    return [];
  }
  return messageRows(
    state.snapshot.messages,
    state.selectedSessionId,
    state.snapshot.sessions,
  );
}

/** Detail-tab projection, or null when nothing is selected. */
export function detailTab(
  state: CockpitState,
  attachHint: string | null = null,
): DetailView | null {
  const session = selectedSession(state);
  return session === null
    ? null
    : detailView(session, state.snapshot.sessions, attachHint);
}

/** Context-tab projection. */
export function contextTab(state: CockpitState): ContextView {
  return contextView(state.env, selectedSession(state));
}

/** New-message badge count for a Session relative to the observed baseline. */
export function badgeFor(state: CockpitState, sessionId: string): number {
  return badgeCountFor(state.snapshot.messages, sessionId, state.baseline);
}

// --- Reducer --------------------------------------------------------------

/** Fold the selected Session's new incoming Messages into the baseline. */
function observeIfViewingMessages(state: CockpitState): CockpitState {
  if (state.activeTab !== "messages" || state.selectedSessionId === null) {
    return state;
  }
  const baseline = observeSession(
    state.snapshot.messages,
    state.selectedSessionId,
    state.baseline,
  );
  return baseline === state.baseline ? state : { ...state, baseline };
}

function moveSelection(state: CockpitState, delta: number): CockpitState {
  const rows = visibleSessionRows(state);
  if (rows.length === 0) {
    return { ...state, selectedSessionId: null };
  }
  const current = rows.findIndex(
    (r) => r.session.id === state.selectedSessionId,
  );
  const base = current === -1 ? 0 : current + delta;
  const clamped = Math.min(Math.max(base, 0), rows.length - 1);
  const nextId = rows[clamped]?.session.id ?? null;
  return observeIfViewingMessages({ ...state, selectedSessionId: nextId });
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = values.indexOf(current);
  const base = index === -1 ? 0 : index + delta;
  const wrapped = (base + values.length) % values.length;
  return values[wrapped] as T;
}

/** No-op dispatch result for actions that cannot apply in the current state. */
function unchanged(state: CockpitState): CockpitDispatchResult {
  return { state };
}

function withEffect(
  state: CockpitState,
  effect: CockpitEffect,
): CockpitDispatchResult {
  return { state, effect };
}

/**
 * Apply an operator action to the cockpit state. Returns the next state and,
 * when the action asks the host to act, a single {@link CockpitEffect}. The
 * function is pure: it performs no I/O and never mutates its input.
 */
export function dispatchCockpit(
  state: CockpitState,
  action: CockpitAction,
): CockpitDispatchResult {
  switch (action.type) {
    case "selectNext":
      return { state: moveSelection(state, 1) };
    case "selectPrev":
      return { state: moveSelection(state, -1) };
    case "select": {
      const exists = visibleSessionRows(state).some(
        (r) => r.session.id === action.sessionId,
      );
      if (!exists) {
        return unchanged(state);
      }
      return {
        state: observeIfViewingMessages({
          ...state,
          selectedSessionId: action.sessionId,
        }),
      };
    }
    case "switchTab":
      return {
        state: observeIfViewingMessages({
          ...state,
          activeTab: cycle(COCKPIT_TABS, state.activeTab, 1),
        }),
      };
    case "setTab":
      return {
        state: observeIfViewingMessages({ ...state, activeTab: action.tab }),
      };
    case "cycleFilter": {
      const filter = cycle(COCKPIT_FILTERS, state.filter, 1);
      return { state: applyFilter(state, filter) };
    }
    case "setFilter":
      return { state: applyFilter(state, action.filter) };
    case "refresh":
      // The host reloads a snapshot and calls applySnapshot; the view-model
      // only asks for it.
      return withEffect(state, { kind: "refresh" });
    case "attach": {
      if (state.selectedSessionId === null) {
        return unchanged(state);
      }
      return withEffect(state, {
        kind: "attach",
        sessionId: state.selectedSessionId,
      });
    }
    case "openSend": {
      if (state.selectedSessionId === null) {
        return unchanged(state);
      }
      return { state: { ...state, modal: { kind: "send", draft: "" } } };
    }
    case "updateDraft": {
      if (state.modal.kind !== "send") {
        return unchanged(state);
      }
      return {
        state: { ...state, modal: { kind: "send", draft: action.draft } },
      };
    }
    case "submitSend": {
      if (state.modal.kind !== "send" || state.selectedSessionId === null) {
        return unchanged(state);
      }
      const body = state.modal.draft;
      const closed: CockpitState = { ...state, modal: { kind: "none" } };
      // An empty draft sends nothing; just close the modal.
      if (body.length === 0) {
        return { state: closed };
      }
      return withEffect(closed, {
        kind: "send",
        sessionId: state.selectedSessionId,
        body,
      });
    }
    case "cancelModal":
      return state.modal.kind === "none"
        ? unchanged(state)
        : { state: { ...state, modal: { kind: "none" } } };
    case "requestClose": {
      if (state.selectedSessionId === null) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          modal: {
            kind: "confirm",
            action: "close",
            sessionId: state.selectedSessionId,
          },
        },
      };
    }
    case "requestDelete": {
      if (state.selectedSessionId === null) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          modal: {
            kind: "confirm",
            action: "delete",
            sessionId: state.selectedSessionId,
          },
        },
      };
    }
    case "confirm": {
      if (state.modal.kind !== "confirm") {
        return unchanged(state);
      }
      const { action: confirmed, sessionId } = state.modal;
      const closed: CockpitState = { ...state, modal: { kind: "none" } };
      return withEffect(closed, { kind: confirmed, sessionId });
    }
    case "toggleHelp": {
      if (state.modal.kind === "help") {
        return { state: { ...state, modal: { kind: "none" } } };
      }
      if (state.modal.kind !== "none") {
        return unchanged(state);
      }
      return { state: { ...state, modal: { kind: "help" } } };
    }
    case "quit":
      return withEffect(state, { kind: "quit" });
    default: {
      // Exhaustiveness guard: every action variant is handled above.
      const _never: never = action;
      return unchanged(_never);
    }
  }
}

/** Apply a status filter and keep the selection valid against the new tree. */
function applyFilter(
  state: CockpitState,
  filter: CockpitStatusFilter,
): CockpitState {
  const next: CockpitState = { ...state, filter };
  const rows = visibleSessionRows(next);
  const stillVisible =
    next.selectedSessionId !== null &&
    rows.some((r) => r.session.id === next.selectedSessionId);
  if (!stillVisible) {
    next.selectedSessionId = rows[0]?.session.id ?? null;
  }
  return observeIfViewingMessages(next);
}
