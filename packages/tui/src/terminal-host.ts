/**
 * The built-in ANSI {@link CockpitHost} — the real terminal driver for
 * `asem tui`.
 *
 * This is the one place in `@asem/tui` that touches a TTY: raw-mode key decoding,
 * a clear-and-repaint frame renderer, and the attach suspend/resume. It uses only
 * Node built-ins (no rendering dependency), and is loaded only by the CLI binary,
 * never by tests — the app loop is exercised through a scripted fake host instead
 * (implementation principle 13; testability rules). The renderer is intentionally
 * minimal; a richer renderer (e.g. OpenTUI) can replace this host behind the same
 * {@link CockpitHost} interface without touching any tested logic.
 */
import { spawnSync } from "node:child_process";
import type { AttachRequest, CockpitHost } from "./host.ts";
import type { KeyEvent } from "./keymap.ts";
import type { CockpitView, LeftRow } from "./view.ts";

const ESC = "\x1b";
const CLEAR = `${ESC}[2J${ESC}[H`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const LEFT_WIDTH = 32;

/** Minimal stdin/stdout streams the host needs (subset of Node's TTY streams). */
export interface TtyInput {
  setRawMode?(mode: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  off(event: "data", listener: (chunk: Buffer | string) => void): void;
  isTTY?: boolean;
}

export interface TtyOutput {
  write(text: string): void;
}

/**
 * Decode a raw input chunk into normalized {@link KeyEvent}s.
 *
 * Heuristics for the modal send flow: CR (`\r`, plain Enter) inserts a newline,
 * while LF (`\n`, sent by Ctrl+Enter on many terminals) is reported as a
 * Ctrl+Enter "send". This is the best portable approximation of "Enter newline,
 * Ctrl+Enter send" (design "TUI behavior").
 */
export function decodeKeys(chunk: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i]!;
    // CSI arrow keys: ESC [ A/B/C/D.
    if (ch === ESC && chunk[i + 1] === "[") {
      const code = chunk[i + 2];
      const arrow =
        code === "A"
          ? "up"
          : code === "B"
            ? "down"
            : code === "C"
              ? "right"
              : code === "D"
                ? "left"
                : null;
      if (arrow !== null) {
        events.push({ key: arrow });
        i += 3;
        continue;
      }
      // Unknown CSI sequence — skip the ESC and continue.
      i += 1;
      continue;
    }
    if (ch === ESC) {
      events.push({ key: "escape" });
      i += 1;
      continue;
    }
    if (ch === "\r") {
      events.push({ key: "return" });
      i += 1;
      continue;
    }
    if (ch === "\n") {
      events.push({ key: "return", ctrl: true });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      events.push({ key: "tab" });
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      events.push({ key: "backspace" });
      i += 1;
      continue;
    }
    const codePoint = ch.charCodeAt(0);
    if (codePoint >= 1 && codePoint <= 26 && ch !== "\t") {
      // Ctrl+letter (e.g. Ctrl+C → \x03). Map back to the letter + ctrl.
      events.push({ key: String.fromCharCode(codePoint + 96), ctrl: true });
      i += 1;
      continue;
    }
    events.push({ key: ch });
    i += 1;
  }
  return events;
}

function leftRowText(row: LeftRow): string {
  if (row.kind === "group") {
    return `▾ ${row.worktreeRoot}`;
  }
  const indent = "  ".repeat(row.depth + 1);
  const badge = row.badge > 0 ? ` +${row.badge}` : "";
  const cursor = row.selected ? "> " : "  ";
  return `${cursor}${indent}${row.symbol} ${row.name}${badge}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

/** Render a {@link CockpitView} to a single frame string. */
export function renderFrame(view: CockpitView): string {
  const left: string[] = [
    view.left.title,
    view.left.scopeLabel,
    view.left.filterLabel,
    "",
    ...view.left.rows.map(leftRowText),
  ];
  const tabBar = view.tabs
    .map((t) => (t.active ? `[${t.title}]` : ` ${t.title} `))
    .join(" ");
  const right: string[] = [tabBar, "", ...view.right];

  const height = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < height; i += 1) {
    lines.push(`${pad(left[i] ?? "", LEFT_WIDTH)}│ ${right[i] ?? ""}`);
  }

  lines.push("");
  lines.push(view.keybar.map((k) => `[${k.key}] ${k.label}`).join("  "));
  if (view.statusLine !== null) {
    lines.push(view.statusLine);
  }
  if (view.modal !== null) {
    lines.push("");
    lines.push(`── ${view.modal.title} ──`);
    for (const line of view.modal.lines) {
      lines.push(line);
    }
    lines.push(view.modal.hint);
  }
  return lines.join("\n");
}

/** Options for {@link AnsiCockpitHost}. */
export interface AnsiHostOptions {
  input?: TtyInput;
  output?: TtyOutput;
}

/** Node-backed ANSI {@link CockpitHost}. */
export class AnsiCockpitHost implements CockpitHost {
  private readonly input: TtyInput;
  private readonly output: TtyOutput;
  private readonly queue: KeyEvent[] = [];
  private waiter: ((event: KeyEvent | null) => void) | null = null;
  private readonly onData = (chunk: Buffer | string): void => {
    for (const event of decodeKeys(chunk.toString())) {
      if (this.waiter !== null) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(event);
      } else {
        this.queue.push(event);
      }
    }
  };

  private started = false;

  constructor(options: AnsiHostOptions = {}) {
    this.input = options.input ?? (process.stdin as unknown as TtyInput);
    this.output = options.output ?? (process.stdout as unknown as TtyOutput);
  }

  /**
   * Enter raw mode and start listening on first use. Deferring the terminal
   * side-effects out of the constructor means a host that is built but never run
   * (e.g. the cockpit pre-flight fails with `config_not_found`) leaves the
   * terminal untouched.
   */
  private ensureStarted(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.input.setRawMode?.(true);
    this.input.resume();
    this.input.on("data", this.onData);
    this.output.write(HIDE_CURSOR);
  }

  draw(view: CockpitView): void {
    this.ensureStarted();
    this.output.write(`${CLEAR}${renderFrame(view)}\n`);
  }

  nextKey(): Promise<KeyEvent | null> {
    this.ensureStarted();
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise<KeyEvent | null>((resolve) => {
      this.waiter = resolve;
    });
  }

  async attach(request: AttachRequest): Promise<void> {
    // Temporarily leave the TUI: restore the terminal, run the attach command,
    // then the app refreshes on return. Real attach is optional — without a
    // resolved attach command we surface guidance and return immediately.
    this.input.setRawMode?.(false);
    this.output.write(SHOW_CURSOR + CLEAR);
    if (request.attachHint !== null && request.attachHint.length > 0) {
      this.output.write(`attaching to ${request.session.name}...\n`);
      spawnSync(request.attachHint, { shell: true, stdio: "inherit" });
    } else {
      this.output.write(
        `no attach command available for ${request.session.name}\n`,
      );
    }
    this.input.setRawMode?.(true);
    this.input.resume();
    this.output.write(HIDE_CURSOR);
  }

  close(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.input.off("data", this.onData);
    this.input.setRawMode?.(false);
    this.input.pause();
    this.output.write(SHOW_CURSOR + CLEAR);
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve(null);
    }
  }
}
