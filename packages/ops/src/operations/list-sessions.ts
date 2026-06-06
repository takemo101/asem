/**
 * `list_sessions` operation — list Sessions in the current Effective Scope.
 *
 * Scope is applied by default (implementation principle 7): the Store query is
 * always bounded by `workspace_id + worktree_root`, so Sessions in sibling
 * worktrees that share a workspace id are never returned (ADR 0002). An optional
 * liveness pass may refresh process state without inferring work outcome.
 */
import {
  type Clock,
  type ConfigLoader,
  type CurrentSessionResolver,
  err,
  type ListSessionsInput,
  type ListSessionsOutput,
  type LivenessProbe,
  listSessionsInputSchema,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Store,
} from "@asem/core";
import { authenticateAgentOrigin, resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { refreshLivenessAll } from "./liveness.ts";

type ListSessionsDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  livenessProbe: LivenessProbe;
  clock: Clock;
};

export async function listSessions(
  deps: ListSessionsDeps,
  rawInput: ListSessionsInput,
  ctx: OpContext,
): Promise<OperationResult<ListSessionsOutput>> {
  const parsed = listSessionsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid list-sessions input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  const auth = await authenticateAgentOrigin(deps, scope, ctx);
  if (!auth.ok) {
    return auth;
  }

  const stored = await deps.store.listSessions(scope, parsed.data.filter);
  const sessions = ctx.refreshLiveness
    ? await refreshLivenessAll(deps, scope, stored)
    : stored;

  return ok({ sessions });
}
