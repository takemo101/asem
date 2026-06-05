/**
 * Runtime-internal error signals shared between the sequence engine and the
 * fake runner. These are control-flow markers, not structured operation errors:
 * the engine catches them and maps them onto `@asem/core` operation error codes.
 */

/** Thrown by a runner when a command exceeds its timeout. */
export class SequenceTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    message = `command timed out after ${timeoutMs}ms`,
  ) {
    super(message);
    this.name = "SequenceTimeoutError";
  }
}
