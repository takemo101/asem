/**
 * `delete_session` operation — destructive removal of a Session and the Messages
 * related to it.
 *
 * Delete is irreversible, so the semantics live here, in `@asem/ops`, not in the
 * Store (which only exposes scoped primitives) and not in an FK cascade. Two
 * rules define the operation:
 *
 *   1. **Explicit confirmation.** The operation refuses to delete unless the
 *      caller passes `force`. Surfaces map their own confirmation/`--force`
 *      affordance onto this flag; the requirement itself is enforced here so no
 *      surface can delete by accident.
 *   2. **No live pane bypass.** A `starting`/`running` Session must be closed
 *      before delete, otherwise store cleanup could leave a real mux pane alive.
 *   3. **Operation-owned related-message cleanup.** A Session's history is the
 *      Messages where it is the sender or the recipient
 *      (`from_session_id = id OR to_session_id = id`). The Store does not decide
 *      that those rows go with the Session; this operation does, removing them
 *      and the Session together inside one Store transaction so the delete is
 *      all-or-nothing.
 *
 * The target is resolved by scoped Store lookup, so a Session in a sibling
 * worktree is `session_not_found` and is never deleted across the isolation
 * boundary (ADR 0002). No delivery/read/ack state is invented or inspected.
 */
import {
  type ConfigLoader,
  type CurrentSessionResolver,
  type DeleteSessionInput,
  type DeleteSessionOutput,
  deleteSessionInputSchema,
  err,
  type Logger,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type SessionStatus,
  type Store,
} from "@asem/core";
import { resolveContext, resolveMutationActor } from "../context.ts";
import type { OpContext } from "../deps.ts";

type DeleteSessionDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  logger?: Logger;
};

const PANE_LIVE_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "starting",
  "running",
]);

export async function deleteSession(
  deps: DeleteSessionDeps,
  rawInput: DeleteSessionInput,
  ctx: OpContext,
): Promise<OperationResult<DeleteSessionOutput>> {
  const parsed = deleteSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid delete-session input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const input = parsed.data;

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  // Auth: the actor ladder (ADR 0003) lives in resolveMutationActor. Agent
  // origin verifies the current Session; an operator surface (TUI) forces local
  // trust so a stale current-session pointer in the target scope cannot block
  // the delete; unset origin verifies a present pointer or deletes under
  // anonymous local trust. Delete needs only the auth side effect, not the
  // resolved actor's Session or token.
  const actorResult = await resolveMutationActor(deps, scope, ctx);
  if (!actorResult.ok) {
    return actorResult;
  }

  // Explicit confirmation is required before any destructive lookup or write.
  if (input.force !== true) {
    return err(
      operationError(
        "invalid_input",
        "delete_session is destructive and requires explicit confirmation (force)",
        { id: input.id },
      ),
    );
  }

  // Scoped lookup enforces same-scope delete: a sibling-worktree Session is not
  // found here, never deleted across the isolation boundary.
  const session = await deps.store.getSessionById(scope, input.id);
  if (session === null) {
    return err(
      operationError("session_not_found", "Session not found in this scope", {
        id: input.id,
      }),
    );
  }

  if (PANE_LIVE_STATUSES.has(session.status)) {
    return err(
      operationError(
        "invalid_input",
        "delete_session refuses to remove a live Session; close it first",
        { id: session.id, status: session.status },
      ),
    );
  }

  // Operation-owned cleanup: remove related Messages and the Session together in
  // one transaction so the delete is all-or-nothing. The Store provides the
  // scoped primitives; this operation decides they belong to one unit of work.
  const deletedMessageCount = await deps.store.withTransaction(async (tx) => {
    const removed = await tx.deleteRelatedMessagesScoped(scope, session.id);
    await tx.deleteSessionScoped(scope, session.id);
    return removed;
  });

  deps.logger?.info("deleted Session", {
    sessionId: session.id,
    deletedMessageCount,
  });
  return ok({ deletedSessionId: session.id, deletedMessageCount });
}
