/**
 * `send_message` and `report_parent` operations — Session-to-Session messaging.
 *
 * A Message is a durable SQLite record plus a best-effort delivery attempt into
 * the target Session's multiplexer pane. It is not an event stream, command,
 * ack, read receipt, or task result (CONTEXT.md). `report_parent` is just
 * `Message(kind="report")` addressed to the current Session's parent.
 *
 * Both operations share one delivery path ({@link deliver}):
 *
 *   1. resolve config + Effective Scope;
 *   2. resolve the sender (agent-originated calls verify the current Session's
 *      token; human local-trust calls send with no source attribution — and an
 *      operator surface forces that human path via `ctx.origin === "operator"`,
 *      so it never adopts the resolved worktree's current-Session pointer);
 *   3. resolve the target Session within the Workspace; cwd/worktreeRoot may
 *      differ and are treated as Session location metadata;
 *   4. record the Message row truthfully, then attempt delivery;
 *   5. on a successful mux `send` sequence set `delivered_at`; on failure set
 *      `delivery_error`. Delivery never fabricates ack/read state, and a
 *      delivery failure never erases the recorded Message (principle 6).
 *
 * The sender's raw token never reaches the formatted body, the Store, the
 * issued command strings, the logs, or the `delivery_error`: a token-scoped
 * redactor masks it everywhere it might surface (principle 8).
 */
import {
  type Clock,
  type ConfigLoader,
  type CurrentSessionResolver,
  type EffectiveScope,
  err,
  type IdGenerator,
  type Logger,
  type Message,
  type MessageKind,
  type OperationResult,
  ok,
  operationError,
  type PublicMessage,
  type Redactor,
  type ReportParentInput,
  type ReportParentOutput,
  reportParentInputSchema,
  type ScopeResolver,
  type SendMessageInput,
  type SendMessageOutput,
  type Session,
  type Store,
  sendMessageInputSchema,
  type TemplateRegistry,
  type TemplateRegistryFactory,
  type TemplateRunner,
} from "@asem/core";
import {
  authenticateCurrentSessionWithToken,
  resolveContext,
  resolveMutationActor,
} from "../context.ts";
import type { OpContext } from "../deps.ts";
import { projectPublicMessage } from "../message-projection.ts";
import { muxExecutionFor } from "../mux-execution.ts";
import { muxRefVars } from "../mux-vars.ts";
import { resolveMuxTemplate } from "../templates.ts";

type MessagingDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  templateRegistryFactory: TemplateRegistryFactory;
  templateRunner: TemplateRunner;
  clock: Clock;
  idGenerator: IdGenerator;
  logger?: Logger;
  redactor?: Redactor;
};

/**
 * Build the exact text delivered into the target pane (`formatted_body`).
 *
 * The header identifies whether this is a message or a report and names the
 * source Session (name + id) so the recipient sees who it is from. A
 * human-originated Message has no source Session, so the header omits the
 * "from" clause.
 */
export function formatMessageBody(
  kind: MessageKind,
  source: { name: string; id: string } | null,
  body: string,
): string {
  const label = kind === "report" ? "report" : "message";
  const header =
    source === null
      ? `[asem ${label}]`
      : `[asem ${label} from ${source.name} (${source.id})]`;
  return `${header}\n${body}`;
}

export async function sendMessage(
  deps: MessagingDeps,
  rawInput: SendMessageInput,
  ctx: OpContext,
): Promise<OperationResult<SendMessageOutput>> {
  const parsed = sendMessageInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid send-message input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const input = parsed.data;

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, scope } = contextResult.value;

  // Auth: the actor ladder (ADR 0003) lives in resolveMutationActor. Agent
  // origin verifies the current Session; an operator surface (TUI) forces the
  // human path with no source attribution so a workspace-scope send into a
  // sibling worktree is not silently impersonated; unset origin attributes to
  // the current Session when one is registered or sends anonymously when none is
  // (MIK-022; ADR 0003). `human-anon`/`operator` carry no Session and no token.
  const actorResult = await resolveMutationActor(deps, scope, ctx);
  if (!actorResult.ok) {
    return actorResult;
  }
  const actor = actorResult.value;

  // Target lookup is Workspace-scoped: sibling worktree Sessions in the same
  // Workspace are addressable, while other Workspaces remain inaccessible.
  const target = await deps.store.getSessionById(scope, input.toSessionId);
  if (target === null) {
    return err(
      operationError(
        "session_not_found",
        "target Session not found in this scope",
        { toSessionId: input.toSessionId },
      ),
    );
  }

  return deliver(deps, scope, {
    fromSession: actor.session,
    target,
    kind: input.kind ?? "message",
    body: input.body,
    token: actor.token,
    // Build the registry from this cwd's config so a project-local mux `send`
    // template overrides the builtin for delivery.
    templateRegistry: deps.templateRegistryFactory.forConfig(config),
  });
}

export async function reportParent(
  deps: MessagingDeps,
  rawInput: ReportParentInput,
  ctx: OpContext,
): Promise<OperationResult<ReportParentOutput>> {
  const parsed = reportParentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid report-parent input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const input = parsed.data;

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, scope } = contextResult.value;

  // report_parent always acts as the current Session: resolve and verify it.
  // Unlike send/close/delete it has no operator/anonymous path, so it does not
  // use resolveMutationActor — it must always be the verified current Session
  // (ADR 0003).
  const auth = await authenticateCurrentSessionWithToken(deps, scope);
  if (!auth.ok) {
    return auth;
  }
  const current = auth.value.session;

  if (current.parentSessionId === null) {
    return err(
      operationError(
        "parent_session_not_found",
        "current Session has no parent to report to",
        { sessionId: current.id },
      ),
    );
  }
  const parent = await deps.store.getSessionById(
    scope,
    current.parentSessionId,
  );
  if (parent === null) {
    return err(
      operationError(
        "parent_session_not_found",
        "parent Session not found in this scope",
        { parentSessionId: current.parentSessionId },
      ),
    );
  }

  return deliver(deps, scope, {
    fromSession: current,
    target: parent,
    kind: "report",
    body: input.body,
    token: auth.value.token,
    templateRegistry: deps.templateRegistryFactory.forConfig(config),
  });
}

/**
 * Record the Message, then make a best-effort delivery into the target pane and
 * persist the outcome. Always returns `ok` once the Message is recorded:
 * delivery state lives on the Message, never in the operation result.
 */
async function deliver(
  deps: MessagingDeps,
  scope: EffectiveScope,
  params: {
    fromSession: Session | null;
    target: Session;
    kind: MessageKind;
    body: string;
    token: string | null;
    templateRegistry: TemplateRegistry;
  },
): Promise<OperationResult<{ message: PublicMessage }>> {
  const { fromSession, target, kind, body, token, templateRegistry } = params;

  const source =
    fromSession === null
      ? null
      : { name: fromSession.name, id: fromSession.id };
  const formattedBody = formatMessageBody(kind, source, body);

  const message: Message = {
    id: deps.idGenerator.nextId(),
    workspaceId: scope.workspaceId,
    // Location metadata follows the delivery target. Workspace remains the
    // communication boundary; worktreeRoot records where this Message was aimed
    // for history, grouping, and worktree filters.
    worktreeRoot: target.worktreeRoot,
    fromSessionId: fromSession?.id ?? null,
    toSessionId: target.id,
    kind,
    body,
    formattedBody,
    deliveredAt: null,
    deliveryError: null,
    createdAt: deps.clock.nowIso(),
  };

  // Persist before mux/template resolution: notification is best effort only.
  await deps.store.insertMessage(message);

  // mux:none intentionally has no notification transport or failure record.
  if (target.mux === "none") {
    return ok({ message: projectPublicMessage(message) });
  }

  // One token-scoped redactor + redacted logger + SequenceEngine for delivery,
  // so the sender's raw token is masked from every sequence error, log line, and
  // persisted `delivery_error` (principle 8).
  const { redactor, logger, engine } = muxExecutionFor(deps, token);

  // Template lookup now happens after persistence. Invalid project-local
  // templates are notification failures for a valid Message, never rejection.
  const muxResult = resolveMuxTemplate(templateRegistry, target.mux);
  if (!muxResult.ok) {
    return recordDeliveryError(
      deps,
      scope,
      message,
      redactor.redact(`${muxResult.error.code}: ${muxResult.error.message}`),
      logger,
    );
  }
  const muxTemplate = muxResult.value;
  if (muxTemplate === undefined) {
    return recordDeliveryError(
      deps,
      scope,
      message,
      redactor.redact(`mux template not found: ${target.mux}`),
      logger,
    );
  }

  const result = await engine.run(muxTemplate.send, {
    cwd: target.cwd,
    variables: { ...muxRefVars(target.muxRef), message: formattedBody },
  });

  if (!result.ok) {
    return recordDeliveryError(
      deps,
      scope,
      message,
      redactor.redact(`${result.error.code}: ${result.error.message}`),
      logger,
    );
  }

  const deliveredAt = deps.clock.nowIso();
  await deps.store.markMessageDelivered(scope, message.id, deliveredAt);
  message.deliveredAt = deliveredAt;
  logger?.info("delivered Message", {
    messageId: message.id,
    toSessionId: target.id,
    kind,
  });
  return ok({ message: projectPublicMessage(message) });
}

/**
 * Persist a delivery failure on the Message and return it. Truthful history: the
 * Message stays recorded with `delivery_error` set and no `delivered_at`, and no
 * ack/read state is fabricated.
 */
async function recordDeliveryError(
  deps: MessagingDeps,
  scope: EffectiveScope,
  message: Message,
  deliveryError: string,
  logger: Logger | undefined,
): Promise<OperationResult<{ message: PublicMessage }>> {
  await deps.store.markMessageDeliveryError(scope, message.id, deliveryError);
  message.deliveryError = deliveryError;
  logger?.warn("Message delivery failed", {
    messageId: message.id,
    toSessionId: message.toSessionId,
    deliveryError,
  });
  return ok({ message: projectPublicMessage(message) });
}
