/**
 * Agent Profile domain types for `@asem/profiles`.
 *
 * An Agent Profile is a named bundle of behavior instructions applied to a new
 * Session's initial prompt (ADR 0007). A profile may optionally carry launch
 * defaults (`agent`, `model`) for user/project profiles; builtins are
 * instructions-only. `@asem/profiles` owns parsing/resolution/rendering;
 * `@asem/core` owns the {@link ProfileSource} enum that the Session schema reuses.
 */
import type { ProfileSource } from "@asem/core";

/**
 * A fully resolved Agent Profile: its id, the source it was resolved from, the
 * optional launch defaults and description, and the instructions rendered before
 * the user prompt. The same shape backs builtin, user, and project profiles.
 */
export interface ResolvedProfile {
  id: string;
  source: ProfileSource;
  /** Optional one-line summary used by list surfaces; null when absent. */
  description: string | null;
  /** Optional create-session default Agent; null when absent. */
  agent: string | null;
  /** Optional create-session default model; null when absent. */
  model: string | null;
  /** The prompt-shaping body, trimmed; never empty. */
  instructions: string;
}

/** The filesystem reads Agent Profile discovery needs (a subset of FileSystem). */
export interface ProfileFs {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  readDir(path: string): Promise<string[]>;
}

/**
 * The two profile directories discovery scans. The builtin source is packaged in
 * code and needs no directory. Both are absolute paths; either may be absent.
 */
export interface ProfileDirs {
  /** `<worktree_root>/.asem/agents`. */
  projectDir: string;
  /** `~/.asem/agents`. */
  userDir: string;
}
