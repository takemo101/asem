/**
 * OpenTUI keyboard event → cockpit {@link KeyEvent} conversion.
 *
 * Pure and renderer-free so the mapping is testable without a terminal. The
 * semantics mirror the ANSI host's `decodeKeys`: plain Enter is `return` (a
 * newline in the send modal), and a linefeed-style Enter (Ctrl+Enter on most
 * terminals) is `return` + ctrl (the send shortcut).
 */
import type { KeyEvent } from "../keymap.ts";

/** The subset of OpenTUI's parsed key event the cockpit cares about. */
export interface OpenTuiKey {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

const SPECIAL_KEYS: ReadonlySet<string> = new Set([
  "up",
  "down",
  "left",
  "right",
  "tab",
  "escape",
  "backspace",
]);

/**
 * Convert an OpenTUI key event to a cockpit {@link KeyEvent}, or `null` when
 * the key has no cockpit meaning (e.g. bare modifiers, function keys).
 */
export function toKeyEvent(key: OpenTuiKey): KeyEvent | null {
  const name = key.name ?? "";

  if (SPECIAL_KEYS.has(name)) {
    return {
      key: name,
      ...(key.ctrl ? { ctrl: true } : {}),
      ...(key.shift ? { shift: true } : {}),
    };
  }
  if (name === "return" || name === "enter") {
    // `\n` (linefeed) is how Ctrl+Enter reaches most terminals.
    const ctrl = Boolean(key.ctrl) || key.sequence === "\n";
    return { key: "return", ...(ctrl ? { ctrl: true } : {}) };
  }
  if (name === "linefeed") {
    return { key: "return", ctrl: true };
  }

  const sequence = key.sequence ?? "";
  if (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= " ") {
    return { key: sequence, ...(key.shift ? { shift: true } : {}) };
  }
  if (key.ctrl && !key.meta && name.length === 1) {
    return { key: name, ctrl: true };
  }
  return null;
}
