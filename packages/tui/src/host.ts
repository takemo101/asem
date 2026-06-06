/**
 * The host seam: the only part of the cockpit that touches a real terminal.
 *
 * The app loop (`app.ts`) drives a {@link CockpitHost} — draw a frame, read a
 * key, occasionally leave to attach — and is otherwise pure orchestration over
 * the view-model and `@asem/ops`. Keeping the terminal behind this interface lets
 * the whole app be tested with a scripted fake host (no real TTY, no real mux),
 * and lets the renderer be swapped (the built-in ANSI host now, OpenTUI later)
 * without changing any tested logic (implementation principle 13).
 */
import type { Session } from "@asem/core";
import type { KeyEvent } from "./keymap.ts";
import type { CockpitView } from "./view.ts";

/** What the host needs to attach to a Session and hand the pane to the human. */
export interface AttachRequest {
  session: Session;
  /** Attach command/guidance from `get_session`, or null when unavailable. */
  attachHint: string | null;
}

/**
 * Terminal driver for the cockpit. Implementations own raw-mode setup, drawing,
 * key decoding, and the attach suspend/resume; the app never assumes a TTY.
 */
export interface CockpitHost {
  /** Paint a frame. Called after every state change. */
  draw(view: CockpitView): void;
  /**
   * Resolve the next key press, or `null` when input has ended (EOF / detached
   * stdin). The app treats `null` as a quit signal.
   */
  nextKey(): Promise<KeyEvent | null>;
  /**
   * Temporarily leave the TUI, run the attach command for a Session, and return
   * control to the cockpit. The app refreshes the snapshot on return (design:
   * "`a` runs the attach command and leaves TUI temporarily; on return, TUI
   * refreshes"). Real attach is optional — a host with no usable attach command
   * may surface guidance and return immediately.
   */
  attach(request: AttachRequest): Promise<void>;
  /** Restore the terminal. Called once when the app loop exits. */
  close(): void;
}
