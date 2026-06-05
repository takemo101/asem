import { z } from "zod";
import { nonEmptyString } from "./common.ts";

/**
 * Effective Scope is the single boundary inside which Sessions can normally see
 * and message each other: `workspace_id + worktree_root`.
 *
 * This definition is the project-wide source of truth. No other package may
 * redefine scope semantics.
 */
export const effectiveScopeSchema = z
  .object({
    workspaceId: nonEmptyString,
    worktreeRoot: nonEmptyString,
  })
  .strict();

export type EffectiveScope = z.infer<typeof effectiveScopeSchema>;
