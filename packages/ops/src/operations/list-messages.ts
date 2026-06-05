/**
 * `list_messages` operation — read Message history in the current scope.
 *
 * Supports three views over the same scoped history:
 * - normal history (optionally narrowed to one target Session);
 * - `inbox`: self-addressed history for the current Session (CONTEXT.md — a
 *   filtered view, not a durable unread queue);
 * - `undelivered`: Messages with no `delivered_at` yet.
 *
 * `inbox` resolves and verifies the current Session, so it surfaces the auth
 * error ladder (current_session_not_found / scope_mismatch / session_not_found /
 * invalid_session_token).
 */
import {
  err,
  ok,
  listMessagesInputSchema,
  operationError,
  type ConfigLoader,
  type CurrentSessionResolver,
  type ListMessagesInput,
  type ListMessagesOutput,
  type MessageListFilter,
  type OperationResult,
  type ScopeResolver,
  type Store,
} from "@asem/core";
import type { OpContext } from "../deps.ts";
import { authenticateCurrentSession, resolveContext } from "../context.ts";

type ListMessagesDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
};

export async function listMessages(
  deps: ListMessagesDeps,
  rawInput: ListMessagesInput,
  ctx: OpContext,
): Promise<OperationResult<ListMessagesOutput>> {
  const parsed = listMessagesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid list-messages input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  const filter = parsed.data.filter;
  let storeFilter: MessageListFilter | undefined = filter;

  // `inbox` is self-addressed history: resolve the current Session and query by
  // its id. The Store has no notion of a "current Session", so ops translates.
  if (filter?.inbox === true) {
    const auth = await authenticateCurrentSession(deps, scope);
    if (!auth.ok) {
      return auth;
    }
    storeFilter = {
      ...filter,
      inbox: false,
      toSessionId: auth.value.id,
    };
  }

  const messages = await deps.store.listMessages(scope, storeFilter);
  return ok({ messages });
}
