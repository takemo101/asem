/**
 * Deterministic virtual time for `wait_ms` and timeout tests.
 *
 * Real wall-clock waits make sequence tests slow and flaky. The fake runner
 * advances a {@link VirtualClock} instead of sleeping, so `wait_ms` steps and
 * timeout decisions are instant and fully deterministic.
 */
export class VirtualClock {
  private ms: number;

  constructor(startMs = 0) {
    this.ms = startMs;
  }

  /** Current virtual time in milliseconds. */
  now(): number {
    return this.ms;
  }

  /** Advance virtual time by `delta` milliseconds (must be non-negative). */
  advance(delta: number): void {
    if (delta < 0) {
      throw new Error("VirtualClock.advance: delta must be non-negative");
    }
    this.ms += delta;
  }
}
