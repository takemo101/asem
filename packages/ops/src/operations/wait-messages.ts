/**
 * `wait_messages` operation — one bounded long-poll on the current Session's
 * unfiltered Inbox after a required cursor (MIK-061/MIK-063).
 *
 * The wait is exactly the `list_messages({ filter: { inbox: true } })` query
 * identity: scope is resolved and the current Session verified on every call
 * before the cursor is compared, and there are no sender/kind filters, so a
 * returned cursor advances through one unambiguous Inbox view and can never
 * silently skip a Message. The injected Store/Clock/Sleeper are polled once per
 * second until a Message arrives or the bound elapses; a timeout is a
 * successful empty page with `timedOut: true`, never an operation error. Rows
 * are exposed only through the public projector.
 */
import {
  type Clock,
  type ConfigLoader,
  type CurrentSessionResolver,
  err,
  type MessageListFilter,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Sleeper,
  type Store,
  WAIT_MESSAGES_DEFAULT_TIMEOUT_MS,
  WAIT_MESSAGES_POLL_INTERVAL_MS,
  type WaitMessagesInput,
  type WaitMessagesOutput,
  waitMessagesInputSchema,
} from "@asem/core";
import { authenticateCurrentSession, resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import {
  decodeMessageCursor,
  encodeMessageCursor,
  messageCursorBinding,
} from "../message-cursor.ts";
import { projectPublicMessage } from "../message-projection.ts";

type WaitMessagesDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  clock: Clock;
  sleeper: Sleeper;
};

export async function waitMessages(
  deps: WaitMessagesDeps,
  rawInput: WaitMessagesInput,
  ctx: OpContext,
): Promise<OperationResult<WaitMessagesOutput>> {
  const parsed = waitMessagesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid wait-messages input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const { cursor, limit } = parsed.data;
  const timeoutMs = parsed.data.timeoutMs ?? WAIT_MESSAGES_DEFAULT_TIMEOUT_MS;

  // `latest` is a list-only tail anchor; a wait needs a concrete position so it
  // cannot skip Messages that arrive between synchronization and waiting.
  if (cursor === "latest") {
    return err(
      operationError(
        "invalid_input",
        "wait requires a concrete Inbox cursor; synchronize with list_messages first",
      ),
    );
  }

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  // Auth precedes cursor comparison: the cursor never authorizes, and a cursor
  // bound to a previous current Session's Inbox fails the binding check below.
  const auth = await authenticateCurrentSession(deps, scope);
  if (!auth.ok) {
    return auth;
  }

  const filter: MessageListFilter = { toSessionId: auth.value.id };
  const binding = messageCursorBinding(scope.workspaceId, filter);
  const decoded = decodeMessageCursor(cursor, binding);
  if (!decoded.ok) {
    return decoded;
  }
  const { afterSequence } = decoded.value;

  const deadline = deps.clock.now().getTime() + timeoutMs;
  while (true) {
    const page = await deps.store.listMessagePage(scope, {
      filter,
      afterSequence,
      ...(limit !== undefined ? { limit } : {}),
    });
    const lastRow = page.rows[page.rows.length - 1];
    if (lastRow !== undefined) {
      return ok({
        messages: page.rows.map((row) => projectPublicMessage(row.message)),
        nextCursor: encodeMessageCursor(binding, lastRow.sequence),
        hasMore: page.hasMore,
        timedOut: false,
      });
    }
    const remaining = deadline - deps.clock.now().getTime();
    if (remaining <= 0) {
      return ok({
        messages: [],
        nextCursor: encodeMessageCursor(binding, afterSequence),
        hasMore: false,
        timedOut: true,
      });
    }
    await deps.sleeper.sleep(
      Math.min(WAIT_MESSAGES_POLL_INTERVAL_MS, remaining),
    );
  }
}
