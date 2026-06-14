/**
 * Agent Profile discovery and source precedence (MIK-041).
 *
 * Profiles resolve from three sources — project (`<worktree_root>/.asem/agents`),
 * user (`~/.asem/agents`), and builtin — with precedence `project > user >
 * builtin`. Replacement is whole-profile: a higher-priority source with the same
 * id replaces the lower entirely, with no merge or append. A duplicate id within
 * a single source is `invalid_config` reporting the conflicting paths. This is
 * the one place precedence lives; surfaces call {@link resolveProfiles} /
 * {@link resolveProfile} and never re-derive it.
 */
import {
  err,
  type OperationResult,
  ok,
  operationError,
  type ProfileSource,
} from "@asem/core";
import { BUILTIN_PROFILES } from "./builtin.ts";
import { parseProfileFile } from "./parse.ts";
import type { ProfileDirs, ProfileFs, ResolvedProfile } from "./types.ts";

/** Join a directory and a basename without depending on `@asem/ops` path helpers. */
function joinDir(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

/** One-line description of a thrown filesystem error for an error's details. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read and parse every `*.md` profile in one directory, failing on a duplicate
 * id. Files are read in sorted order so the error's conflicting paths are
 * deterministic.
 *
 * A *missing* directory yields an empty list (the source is optional). But a
 * directory that exists yet cannot be listed (permissions, not-a-directory, I/O)
 * and any file that cannot be read are treated as invalid profile configuration,
 * not silently skipped: both surface as a structured `invalid_config` carrying
 * the source and offending path. This keeps a broken profile setup loud instead
 * of letting a profile vanish from resolution.
 */
async function readSourceProfiles(
  fs: ProfileFs,
  dir: string,
  source: ProfileSource,
): Promise<OperationResult<ResolvedProfile[]>> {
  if (!(await fs.exists(dir))) {
    return ok([]);
  }
  let entries: string[];
  try {
    entries = await fs.readDir(dir);
  } catch (error) {
    return err(
      operationError(
        "invalid_config",
        `could not read ${source} profiles directory`,
        { source, dir, issues: [describeError(error)] },
      ),
    );
  }
  const names = entries
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const profiles: ResolvedProfile[] = [];
  const pathById = new Map<string, string>();
  for (const name of names) {
    const path = joinDir(dir, name);
    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (error) {
      return err(
        operationError(
          "invalid_config",
          `could not read ${source} profile file`,
          { source, path, issues: [describeError(error)] },
        ),
      );
    }
    const parsed = parseProfileFile(text, source, path);
    if (!parsed.ok) {
      return parsed;
    }
    const existing = pathById.get(parsed.value.id);
    if (existing !== undefined) {
      return err(
        operationError(
          "invalid_config",
          `duplicate profile id "${parsed.value.id}" in ${source} profiles`,
          { id: parsed.value.id, source, paths: [existing, path] },
        ),
      );
    }
    pathById.set(parsed.value.id, path);
    profiles.push(parsed.value);
  }
  return ok(profiles);
}

/**
 * Resolve all profiles with precedence applied, sorted by id. Builtins are the
 * base; user profiles replace builtins; project profiles replace both.
 */
export async function resolveProfiles(
  fs: ProfileFs,
  dirs: ProfileDirs,
): Promise<OperationResult<ResolvedProfile[]>> {
  const project = await readSourceProfiles(fs, dirs.projectDir, "project");
  if (!project.ok) {
    return project;
  }
  const user = await readSourceProfiles(fs, dirs.userDir, "user");
  if (!user.ok) {
    return user;
  }

  const byId = new Map<string, ResolvedProfile>();
  // Lowest precedence first; later sources overwrite the whole entry.
  for (const profile of BUILTIN_PROFILES) {
    byId.set(profile.id, profile);
  }
  for (const profile of user.value) {
    byId.set(profile.id, profile);
  }
  for (const profile of project.value) {
    byId.set(profile.id, profile);
  }

  return ok([...byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

/**
 * Resolve one profile by id. An unknown id is `invalid_input` (a caller mistake),
 * distinct from the `invalid_config` a malformed/duplicate profile file produces.
 */
export async function resolveProfile(
  fs: ProfileFs,
  dirs: ProfileDirs,
  id: string,
): Promise<OperationResult<ResolvedProfile>> {
  const all = await resolveProfiles(fs, dirs);
  if (!all.ok) {
    return all;
  }
  const found = all.value.find((profile) => profile.id === id);
  if (found === undefined) {
    return err(
      operationError("invalid_input", `unknown Agent Profile: ${id}`, {
        profile: id,
      }),
    );
  }
  return ok(found);
}
