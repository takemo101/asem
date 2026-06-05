/**
 * Pure POSIX shell escaping.
 *
 * Shell escaping is centralized in `@asem/core` so every runtime/template uses
 * the same behavior (implementation principle 9). `@asem/runtime` template
 * interpolation exposes raw and `_shell` variants built on this primitive;
 * command strings should always use the escaped variant.
 *
 * The strategy is single-quote wrapping: inside single quotes the shell treats
 * every character literally, so the only character needing special handling is
 * the single quote itself, closed and re-opened as `'\''`.
 */

/** Escape a single value for safe inclusion in a POSIX shell command. */
export function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Escape and space-join multiple values (e.g. an argv list). */
export function shellEscapeAll(values: readonly string[]): string {
  return values.map(shellEscape).join(" ");
}
