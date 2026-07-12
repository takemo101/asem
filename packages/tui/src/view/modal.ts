/**
 * Modal overlay projection: {@link CockpitState} → a renderer-agnostic
 * {@link ModalView}. One of the cockpit's render projections (see `../view.ts`),
 * split out so the send/confirm/help/error overlay shapes — and the error-dialog
 * line cap — live in one place. Pure data; the host decides styling.
 */
import type { CockpitState } from "../types.ts";
import { selectedSession } from "../view-model.ts";

/** The active overlay rendered above the panes. */
export type ModalView =
  | { kind: "send"; title: string; lines: string[]; hint: string }
  | { kind: "confirm"; title: string; lines: string[]; hint: string }
  | { kind: "help"; title: string; lines: string[]; hint: string }
  | { kind: "error"; title: string; lines: string[]; hint: string };

/** Max body lines of the error dialog; longer messages are elided with `…`. */
export const ERROR_MODAL_MAX_LINES = 10;

/** Help-overlay body: every keybinding the cockpit supports. */
const HELP_LINES: readonly string[] = [
  "↑/k, ↓/j   select previous / next Session",
  "Tab        switch Messages / Detail / Context",
  "e          expand/collapse Message bodies (Messages) or Technical (Detail)",
  "a          attach to the selected Session",
  "s          send a Message (Ctrl+Enter send, Esc cancel)",
  "c          close the selected Session",
  "D          delete the selected Session",
  "r          refresh",
  "f          cycle the status filter",
  "?          toggle this help",
  "q          quit",
];

/** Project the active modal state into a {@link ModalView}, or null when none. */
export function modalView(state: CockpitState): ModalView | null {
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
