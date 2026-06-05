/**
 * Output seam for the CLI surface.
 *
 * Rendering produces plain lines; this port decides where they go. Keeping it
 * injected lets command tests capture stdout/stderr as arrays and assert on
 * fields without touching the real process streams (testability rules).
 */

/** Where rendered CLI lines are written. `out` is stdout; `err` is stderr. */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/** In-memory {@link CliIo} for tests: collects stdout/stderr lines separately. */
export class BufferIo implements CliIo {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];

  out(line: string): void {
    this.stdout.push(line);
  }

  err(line: string): void {
    this.stderr.push(line);
  }

  /** All stdout lines joined with newlines (convenience for assertions). */
  outText(): string {
    return this.stdout.join("\n");
  }

  /** All stderr lines joined with newlines (convenience for assertions). */
  errText(): string {
    return this.stderr.join("\n");
  }
}

/** Real {@link CliIo} writing to the process streams, one line each. */
export const processIo: CliIo = {
  out(line: string): void {
    process.stdout.write(`${line}\n`);
  },
  err(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};
