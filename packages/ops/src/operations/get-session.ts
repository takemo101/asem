/**
 * `get_session` operation — read one Session in the current Effective Scope.
 *
 * The scoped Store lookup means a Session in another worktree is reported as
 * `session_not_found`, not leaked across the isolation boundary (ADR 0002). An
 * optional liveness pass may refresh process state without inferring work
 * outcome.
 */
import {
  type Clock,
  type ConfigLoader,
  err,
  type GetSessionInput,
  type GetSessionOutput,
  getSessionInputSchema,
  type LivenessProbe,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Store,
} from "@asem/core";
import { resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { refreshLiveness } from "./liveness.ts";

type GetSessionDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  livenessProbe: LivenessProbe;
  clock: Clock;
};

export async function getSession(
  deps: GetSessionDeps,
  rawInput: GetSessionInput,
  ctx: OpContext,
): Promise<OperationResult<GetSessionOutput>> {
  const parsed = getSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid get-session input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  const stored = await deps.store.getSessionById(scope, parsed.data.id);
  if (stored === null) {
    return err(
      operationError("session_not_found", "Session not found in this scope", {
        id: parsed.data.id,
      }),
    );
  }

  const session = ctx.refreshLiveness
    ? await refreshLiveness(deps, scope, stored)
    : stored;

  return ok({ session });
}
