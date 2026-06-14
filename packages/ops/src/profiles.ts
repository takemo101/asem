/**
 * Agent Profile directory layout for `@asem/ops` (MIK-041).
 *
 * Pure string composition only, mirroring `paths.ts`: it maps a Worktree Root
 * and the user's home directory onto the two profile source directories that
 * `@asem/profiles` discovery scans. Profile parsing, precedence, and rendering
 * stay in `@asem/profiles`; ops only supplies the rooted inputs.
 */
import type { ProfileDirs } from "@asem/profiles";
import { joinPath } from "./paths.ts";

/** Project + user Agent Profile directories for a worktree and home dir. */
export function profileDirsFor(
  worktreeRoot: string,
  homeDir: string,
): ProfileDirs {
  return {
    projectDir: joinPath(worktreeRoot, ".asem", "agents"),
    userDir: joinPath(homeDir, ".asem", "agents"),
  };
}
