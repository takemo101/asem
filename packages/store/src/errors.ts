/**
 * Store-layer errors.
 *
 * `@asem/store` exposes scoped persistence primitives only; it never decides
 * use-case semantics. These errors mark conditions the store can detect at the
 * persistence boundary — a scoped uniqueness violation, or a DB row that fails
 * to parse into a typed `@asem/core` value. `@asem/ops` catches them and maps
 * them onto structured operation errors for surfaces.
 */

export type StoreErrorCode = "session_name_conflict" | "row_parse_failed";

/**
 * A typed persistence-boundary failure. `session_name_conflict` is recoverable
 * (a caller chose a duplicate Session name within an Effective Scope);
 * `row_parse_failed` signals DB corruption — a stored row no longer matches the
 * domain schema — and should be treated as a defect by callers.
 */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: StoreErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** Type guard for {@link StoreError}, optionally narrowed to a single code. */
export function isStoreError(
  value: unknown,
  code?: StoreErrorCode,
): value is StoreError {
  return (
    value instanceof StoreError && (code === undefined || value.code === code)
  );
}
