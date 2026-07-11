/**
 * `list_messages` operation — cursor-paginated Message history in the current
 * scope (MIK-061).
 *
 * Supports three views over the same scoped history:
 * - normal history (optionally narrowed to one target Session);
 * - `inbox`: self-addressed history for the current Session (a filtered view,
 *   not a durable unread queue);
 * - `undelivered`: Messages with no `delivered_at` yet.
 *
 * Every page is ordered by internal sequence, oldest to newest. Scope is
 * resolved and the caller authenticated on every call before any cursor is
 * compared — a cursor only binds a query identity, it never authorizes.
 * `inbox` resolves and verifies the current Session, so it surfaces the auth
 * error ladder (current_session_not_found / scope_mismatch / session_not_found /
 * invalid_session_token). Rows are exposed only through the public projector.
 */
import {
  type ConfigLoader,
  type CurrentSessionResolver,
  type EffectiveScope,
  err,
  type ListMessagesInput,
  type ListMessagesOutput,
  listMessagesInputSchema,
  MESSAGE_PAGE_MAX_LIMIT,
  type MessageListFilter,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Store,
} from "@asem/core";
import {
  authenticateAgentOrigin,
  authenticateCurrentSession,
  resolveContext,
} from "../context.ts";
import type { OpContext } from "../deps.ts";
import {
  decodeMessageCursor,
  encodeMessageCursor,
  messageCursorBinding,
} from "../message-cursor.ts";
import { projectPublicMessage } from "../message-projection.ts";

type ListMessagesDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
};

/** Explicit tail-start cursor: skip history, anchor at the high-water mark. */
const LATEST_CURSOR = "latest";

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

  const auth = await authenticateAgentOrigin(deps, scope, ctx);
  if (!auth.ok) {
    return auth;
  }

  const filter = parsed.data.filter;
  let resolvedFilter: MessageListFilter | undefined = filter;

  // `inbox` is self-addressed history: resolve the current Session and query by
  // its id. The Store has no notion of a "current Session", so ops translates —
  // on every call, so a cursor bound to a previous Session cannot authorize.
  if (filter?.inbox === true) {
    const auth = await authenticateCurrentSession(deps, scope);
    if (!auth.ok) {
      return auth;
    }
    resolvedFilter = {
      ...filter,
      inbox: false,
      toSessionId: auth.value.id,
    };
  }

  const storeFilter = normalizeResultFilter(resolvedFilter);
  const binding = messageCursorBinding(scope.workspaceId, storeFilter);
  const { cursor, limit } = parsed.data;

  if (cursor === LATEST_CURSOR) {
    const tail = await tailSequence(deps.store, scope, storeFilter);
    return ok({
      messages: [],
      nextCursor: encodeMessageCursor(binding, tail),
      hasMore: false,
    });
  }

  let afterSequence = 0;
  if (cursor !== undefined) {
    const decoded = decodeMessageCursor(cursor, binding);
    if (!decoded.ok) {
      return decoded;
    }
    afterSequence = decoded.value.afterSequence;
  }

  const page = await deps.store.listMessagePage(scope, {
    ...(storeFilter !== undefined ? { filter: storeFilter } : {}),
    afterSequence,
    ...(limit !== undefined ? { limit } : {}),
  });
  const lastRow = page.rows[page.rows.length - 1];
  return ok({
    messages: page.rows.map((row) => projectPublicMessage(row.message)),
    nextCursor: encodeMessageCursor(
      binding,
      lastRow?.sequence ?? afterSequence,
    ),
    hasMore: page.hasMore,
  });
}

/**
 * Drop no-op filter spellings (`inbox: false`, `undelivered: false`, absent
 * fields) so one result set has one Store query and one cursor identity.
 */
function normalizeResultFilter(
  filter: MessageListFilter | undefined,
): MessageListFilter | undefined {
  if (filter === undefined) {
    return undefined;
  }
  const normalized: MessageListFilter = {
    ...(filter.toSessionId !== undefined
      ? { toSessionId: filter.toSessionId }
      : {}),
    ...(filter.worktreeRoot !== undefined
      ? { worktreeRoot: filter.worktreeRoot }
      : {}),
    ...(filter.undelivered === true ? { undelivered: true } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Highest matching sequence for a query — the `latest` tail anchor. The Store
 * exposes only the bounded page primitive, so this walks pages to the tail;
 * `latest` is an explicit human-chosen tail start, not a hot path.
 */
async function tailSequence(
  store: Store,
  scope: EffectiveScope,
  filter: MessageListFilter | undefined,
): Promise<number> {
  let after = 0;
  while (true) {
    const page = await store.listMessagePage(scope, {
      ...(filter !== undefined ? { filter } : {}),
      afterSequence: after,
      limit: MESSAGE_PAGE_MAX_LIMIT,
    });
    const last = page.rows[page.rows.length - 1];
    if (last === undefined) {
      return after;
    }
    after = last.sequence;
    if (!page.hasMore) {
      return after;
    }
  }
}
