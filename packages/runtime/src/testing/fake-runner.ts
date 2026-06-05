import type {
  CommandRequest,
  CommandResult,
  TemplateRunner,
} from "@asem/core";
import { SequenceTimeoutError } from "../errors.ts";
import { VirtualClock } from "./virtual-clock.ts";

/**
 * Fake {@link TemplateRunner} — the deterministic test harness for the sequence
 * engine (implementation principle 4, design "Fake runner contract").
 *
 * It records ordered command traces with cwd/env/timeout/background metadata and
 * lets tests script per-call stdout, stderr, exit code, background handles,
 * timeouts, capture fixtures, and generic failures. `wait_ms` and timeouts use
 * the {@link VirtualClock}, so no real time passes.
 *
 * Scripts are consumed FIFO: the Nth `run()` call uses the Nth `commands` entry
 * (and the Nth `writeFile()` call the Nth `writes` entry). Calls beyond the
 * scripted list fall back to a successful default.
 */

/** Scripted outcome for one `run()` call. */
export interface FakeCommandScript {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Virtual duration; if it exceeds the request timeout the call times out. */
  durationMs?: number;
  /** Handle returned for a background request (defaults to `bg-<n>`). */
  backgroundHandle?: string;
  /** Force a timeout regardless of duration/timeout. */
  timeout?: boolean;
  /** Inject a generic failure: `run()` throws with this message. */
  fail?: string;
}

/** Scripted outcome for one `writeFile()` call. */
export interface FakeWriteScript {
  /** Inject a generic failure: `writeFile()` throws with this message. */
  fail?: string;
}

export interface CommandTrace {
  command: string;
  cwd: string | undefined;
  env: Record<string, string> | undefined;
  timeoutMs: number | undefined;
  background: boolean;
}

export interface WriteTrace {
  path: string;
  contents: string;
  mode: number | undefined;
}

/** Unified, ordered trace event for cross-step ordering assertions. */
export type TraceEvent =
  | { type: "run"; command: string; background: boolean }
  | { type: "write_file"; path: string }
  | { type: "wait_ms"; ms: number };

export interface FakeRunnerOptions {
  commands?: FakeCommandScript[];
  writes?: FakeWriteScript[];
  startTimeMs?: number;
}

export class FakeTemplateRunner implements TemplateRunner {
  readonly commands: CommandTrace[] = [];
  readonly writes: WriteTrace[] = [];
  readonly waits: number[] = [];
  readonly events: TraceEvent[] = [];
  readonly clock: VirtualClock;

  private readonly commandScripts: FakeCommandScript[];
  private readonly writeScripts: FakeWriteScript[];
  private commandIndex = 0;
  private writeIndex = 0;
  private backgroundCounter = 0;

  constructor(options: FakeRunnerOptions = {}) {
    this.commandScripts = options.commands ?? [];
    this.writeScripts = options.writes ?? [];
    this.clock = new VirtualClock(options.startTimeMs ?? 0);
  }

  async run(request: CommandRequest): Promise<CommandResult> {
    const background = request.background ?? false;
    this.commands.push({
      command: request.command,
      cwd: request.cwd,
      env: request.env,
      timeoutMs: request.timeoutMs,
      background,
    });
    this.events.push({
      type: "run",
      command: request.command,
      background,
    });

    const script = this.commandScripts[this.commandIndex] ?? {};
    this.commandIndex += 1;

    if (script.fail !== undefined) {
      throw new Error(script.fail);
    }

    const duration = script.durationMs ?? 0;
    const timeoutMs = request.timeoutMs;
    const timedOut =
      script.timeout === true ||
      (timeoutMs !== undefined && duration > timeoutMs);
    if (timedOut) {
      this.clock.advance(timeoutMs ?? duration);
      throw new SequenceTimeoutError(timeoutMs ?? duration);
    }

    this.clock.advance(duration);

    const result: CommandResult = {
      stdout: script.stdout ?? "",
      stderr: script.stderr ?? "",
      exitCode: script.exitCode ?? 0,
    };
    if (background) {
      this.backgroundCounter += 1;
      result.backgroundHandle =
        script.backgroundHandle ?? `bg-${this.backgroundCounter}`;
    }
    return result;
  }

  async writeFile(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void> {
    this.writes.push({ path, contents, mode: options?.mode });
    this.events.push({ type: "write_file", path });

    const script = this.writeScripts[this.writeIndex] ?? {};
    this.writeIndex += 1;
    if (script.fail !== undefined) {
      throw new Error(script.fail);
    }
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
    this.events.push({ type: "wait_ms", ms });
    this.clock.advance(ms);
  }
}
