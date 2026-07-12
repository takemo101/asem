/**
 * Keyboard → {@link CockpitAction} mapping.
 *
 * This is the pure, testable bridge between a normalized {@link KeyEvent} and the
 * view-model reducer: the terminal host decodes raw bytes into {@link KeyEvent}s,
 * this maps them to actions, and {@link dispatchCockpit} applies them. Keeping it
 * pure means every keybinding — including the send modal's multiline editing and
 * the confirm dialogs — is covered without a real terminal.
 *
 * The mapping is modal-aware: in the send modal, printable keys edit the draft,
 * Enter inserts a newline, Ctrl+Enter sends, and Esc cancels (design "TUI
 * behavior"). In a confirm dialog only y/Enter and n/Esc are meaningful.
 */
import type { CockpitAction, CockpitState } from "./types.ts";

/**
 * A normalized key press. `key` is a logical name: a single printable character
 * (`"a"`, `"D"`, `" "`) or a special-key name (`"up"`, `"down"`, `"tab"`,
 * `"return"`, `"escape"`, `"backspace"`). Modifiers are explicit so the host
 * does not have to encode them into `key`.
 */
export interface KeyEvent {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
}

/** True when the event is a single printable character (not a control char). */
function isPrintable(event: KeyEvent): boolean {
  return (
    !event.ctrl &&
    event.key.length === 1 &&
    event.key >= " " &&
    event.key !== ""
  );
}

/** Map a key press to an action while the send modal is open. */
function sendModalAction(
  state: CockpitState,
  event: KeyEvent,
): CockpitAction | null {
  if (state.modal.kind !== "send") {
    return null;
  }
  const draft = state.modal.draft;
  if (event.key === "escape") {
    return { type: "cancelModal" };
  }
  if (event.key === "return" || event.key === "enter") {
    // Ctrl+Enter sends; a bare Enter inserts a newline (multiline input).
    return event.ctrl
      ? { type: "submitSend" }
      : { type: "updateDraft", draft: `${draft}\n` };
  }
  if (event.key === "backspace") {
    return { type: "updateDraft", draft: draft.slice(0, -1) };
  }
  if (isPrintable(event)) {
    return { type: "updateDraft", draft: `${draft}${event.key}` };
  }
  return null;
}

/** Map a key press to an action while a confirm dialog is open. */
function confirmModalAction(event: KeyEvent): CockpitAction | null {
  if (event.key === "escape" || event.key === "n" || event.key === "N") {
    return { type: "cancelModal" };
  }
  if (
    event.key === "y" ||
    event.key === "Y" ||
    event.key === "return" ||
    event.key === "enter"
  ) {
    return { type: "confirm" };
  }
  return null;
}

/**
 * Map a key press to an action while the error dialog is open. Only dismissal
 * is meaningful: Esc, Enter, and `q` close it (so a reflexive `q` never quits
 * the cockpit out from under an unread error); everything else is inert.
 */
function errorModalAction(event: KeyEvent): CockpitAction | null {
  if (
    event.key === "escape" ||
    event.key === "return" ||
    event.key === "enter" ||
    event.key === "q"
  ) {
    return { type: "cancelModal" };
  }
  return null;
}

/** Map a key press to an action while the help overlay is open. */
function helpModalAction(event: KeyEvent): CockpitAction | null {
  if (event.key === "escape" || event.key === "?" || event.key === "q") {
    return { type: "toggleHelp" };
  }
  return null;
}

/** Map a key press to an action in the normal (no-modal) cockpit. */
function normalAction(event: KeyEvent): CockpitAction | null {
  if (event.ctrl) {
    return null;
  }
  switch (event.key) {
    case "up":
    case "k":
      return { type: "selectPrev" };
    case "down":
    case "j":
      return { type: "selectNext" };
    case "tab":
      return { type: "switchTab" };
    case "a":
      return { type: "attach" };
    case "s":
      return { type: "openSend" };
    case "c":
      return { type: "requestClose" };
    case "D":
      return { type: "requestDelete" };
    case "r":
      return { type: "refresh" };
    case "e":
      return { type: "toggleExpand" };
    case "f":
      return { type: "cycleFilter" };
    case "?":
      return { type: "toggleHelp" };
    case "q":
      return { type: "quit" };
    default:
      return null;
  }
}

/**
 * Resolve the {@link CockpitAction} for a key press given the current state, or
 * `null` when the key is not bound in the active mode. Modal modes take
 * precedence over the normal keybindings so, e.g., `q` typed into the send modal
 * edits the draft instead of quitting.
 */
export function keyToAction(
  state: CockpitState,
  event: KeyEvent,
): CockpitAction | null {
  switch (state.modal.kind) {
    case "send":
      return sendModalAction(state, event);
    case "confirm":
      return confirmModalAction(event);
    case "help":
      return helpModalAction(event);
    case "error":
      return errorModalAction(event);
    case "none":
      return normalAction(event);
    default: {
      const _never: never = state.modal;
      return _never;
    }
  }
}
