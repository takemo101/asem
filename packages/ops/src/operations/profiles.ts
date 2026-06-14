/**
 * Agent Profile discovery operations: `list_profiles` and `get_profile`.
 *
 * Both are thin use-cases over `@asem/profiles`: resolve the Effective Scope for
 * `cwd`, derive the project/user profile directories, and delegate the actual
 * parsing/precedence to the shared package. CLI and MCP surfaces call these so
 * neither re-implements profile discovery (architecture: surfaces own no domain
 * decisions).
 */
import {
  err,
  type GetProfileInput,
  getProfileInputSchema,
  type ListProfilesInput,
  listProfilesInputSchema,
  type OperationResult,
  ok,
  operationError,
} from "@asem/core";
import {
  type ResolvedProfile,
  resolveProfile,
  resolveProfiles,
} from "@asem/profiles";
import { resolveContext } from "../context.ts";
import type { OpContext, OpsDeps } from "../deps.ts";
import { profileDirsFor } from "../profiles.ts";

type ProfileDeps = Pick<
  OpsDeps,
  "fs" | "configLoader" | "scopeResolver" | "hostPaths"
>;

export interface ListProfilesOutput {
  profiles: ResolvedProfile[];
}

export interface GetProfileOutput {
  profile: ResolvedProfile;
}

/** List every resolved Agent Profile (project > user > builtin), sorted by id. */
export async function listProfiles(
  deps: ProfileDeps,
  _input: ListProfilesInput,
  ctx: OpContext,
): Promise<OperationResult<ListProfilesOutput>> {
  const parsed = listProfilesInputSchema.safeParse(_input);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid list-profiles input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const dirs = profileDirsFor(
    contextResult.value.scope.worktreeRoot,
    deps.hostPaths.homeDir(),
  );
  const result = await resolveProfiles(deps.fs, dirs);
  if (!result.ok) {
    return err(result.error);
  }
  return ok({ profiles: result.value });
}

/** Fetch one resolved Agent Profile by id; unknown id is `invalid_input`. */
export async function getProfile(
  deps: ProfileDeps,
  input: GetProfileInput,
  ctx: OpContext,
): Promise<OperationResult<GetProfileOutput>> {
  const parsed = getProfileInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid get-profile input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const dirs = profileDirsFor(
    contextResult.value.scope.worktreeRoot,
    deps.hostPaths.homeDir(),
  );
  const result = await resolveProfile(deps.fs, dirs, parsed.data.id);
  if (!result.ok) {
    return err(result.error);
  }
  return ok({ profile: result.value });
}
