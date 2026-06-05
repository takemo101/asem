/**
 * Pure path and runtime-layout helpers for `@asem/ops`.
 *
 * `@asem/ops` must not import concrete filesystem behavior, so these helpers do
 * only string composition. They centralize the asem runtime layout (ADR 0001)
 * so callers cannot drift from the ignored, token-bearing paths.
 */

/** Mode for token-bearing files: owner read/write only (implementation principle 8). */
export const TOKEN_FILE_MODE = 0o600;

/**
 * Runtime ignore rules `asem init` adds so token/log state never enters Git
 * (ADR 0001). Order is stable for deterministic file output and tests.
 */
export const RUNTIME_GITIGNORE_RULES: readonly string[] = [
  ".asem/sessions/",
  ".asem/current-session*.json",
  ".asem/tokens/",
];

/**
 * Join POSIX path segments. The first segment keeps a leading slash (absolute
 * roots); every segment has surrounding slashes trimmed before joining. Empty
 * segments are dropped. Pure: no filesystem access, no platform branching.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) =>
      index === 0
        ? segment.replace(/\/+$/, "")
        : segment.replace(/^\/+|\/+$/g, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");
}

/** Directory of a file path (everything before the last slash), or "." */
export function dirName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return ".";
  if (idx === 0) return "/";
  return trimmed.slice(0, idx);
}

/** Project config path for a worktree/cwd. */
export function configPathFor(cwd: string): string {
  return joinPath(cwd, ".asem.yaml");
}

/** `.gitignore` path for a worktree/cwd. */
export function gitignorePathFor(cwd: string): string {
  return joinPath(cwd, ".gitignore");
}

/** Worktree-local Session directory for a Session id. */
export function sessionDirFor(worktreeRoot: string, sessionId: string): string {
  return joinPath(worktreeRoot, ".asem", "sessions", sessionId);
}

/** Worktree-local raw-token file (mode 0600) for a Session id. */
export function tokenFileFor(worktreeRoot: string, sessionId: string): string {
  return joinPath(worktreeRoot, ".asem", "tokens", `${sessionId}.token`);
}

/** Non-secret current-session pointer file for a worktree. */
export function currentSessionFileFor(worktreeRoot: string): string {
  return joinPath(worktreeRoot, ".asem", "current-session.json");
}
