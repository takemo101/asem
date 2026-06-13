/**
 * `close_session` operation — process/pane lifecycle control + status update.
 *
 * Close means exactly two things (CONTEXT.md, design "close/delete"):
 *
 *   1. best-effort control of the multiplexer pane via the mux `close` sequence;
 *   2. recording that the Session is now `closed` (status + `closed_at`).
 *
 * It never encodes a work outcome. Session status is process/connection state
 * only, so close moves a live Session to `closed` and stamps `closed_at`; it does
 * not judge whether the agent finished its assignment.
 *
 * The target is resolved by scoped Store lookup, so a Session in a sibling
 * worktree is simply `session_not_found` — never closed across the isolation
 * boundary (ADR 0002). Mux `close` is invoked through `@asem/runtime` only when a
 * live pane could exist (`starting`/`running`); a Session that already `exited`,
 * is `missing`, or is `closed` has no live pane to control, so close records the
 * truth without pretending to kill a process it did not.
 *
 * Truthfulness over optimism: if the mux `close` sequence fails, the pane may
 * still be alive, so the operation returns the structured sequence error and
 * leaves the stored status unchanged rather than falsely marking the Session
 * `closed`. No delivery/read/ack state is invented anywhere in this path.
 */
import {
  type Clock,
  type CloseSessionInput,
  type CloseSessionOutput,
  type ConfigLoader,
  type CurrentSessionResolver,
  closeSessionInputSchema,
  err,
  type Logger,
  type OperationResult,
  ok,
  operationError,
  type Redactor,
  type ScopeResolver,
  type SessionStatus,
  type Store,
  type TemplateRegistryFactory,
  type TemplateRunner,
} from "@asem/core";
import {
  createRedactor,
  type MuxTemplate,
  noopRedactor,
  SequenceEngine,
  withRedaction,
} from "@asem/runtime";
import { authenticateCurrentSession, resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { muxRefVars } from "../mux-vars.ts";
import { resolveMuxTemplate } from "../templates.ts";

type CloseSessionDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  templateRegistryFactory: TemplateRegistryFactory;
  templateRunner: TemplateRunner;
  clock: Clock;
  logger?: Logger;
  redactor?: Redactor;
};

/** Statuses where a live pane could still exist and warrant a mux `close`. */
const PANE_LIVE_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "starting",
  "running",
]);

export async function closeSession(
  deps: CloseSessionDeps,
  rawInput: CloseSessionInput,
  ctx: OpContext,
): Promise<OperationResult<CloseSessionOutput>> {
  const parsed = closeSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid close-session input", {
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

  // Auth: MCP/agent-origin calls must verify the current Session. Human
  // local-trust calls keep the previous behavior: if a pointer is present,
  // verify it; if none is present, close under local trust. An explicit
  // operator surface (TUI) forces local trust and must not be blocked by a
  // stale current-session pointer in the target scope.
  let currentToken: string | null = null;
  if (ctx.origin !== "operator") {
    const ref = await deps.currentSessionResolver.resolve(scope);
    if (ctx.origin === "agent" || ref !== null) {
      const auth = await authenticateCurrentSession(deps, scope);
      if (!auth.ok) {
        return auth;
      }
      currentToken = ref?.token ?? null;
    }
  }

  // Scoped lookup enforces same-scope close: a sibling-worktree Session is not
  // found here, never closed across the isolation boundary.
  const session = await deps.store.getSessionById(scope, input.id);
  if (session === null) {
    return err(
      operationError("session_not_found", "Session not found in this scope", {
        id: input.id,
      }),
    );
  }

  // Already closed: idempotent and truthful — do not re-stamp `closed_at`.
  if (session.status === "closed") {
    return ok({ session });
  }

  const redactor = redactorFor(deps, currentToken);
  const logger =
    deps.logger !== undefined
      ? withRedaction(deps.logger, redactor)
      : undefined;

  // Mux `close` runs only when a live pane could exist and asem owns the mux
  // resource. Sessions registered through `init-session` borrow an existing
  // pane/workspace (notably the operator's current herdr workspace), so their
  // mux ref carries `asem_mux_owned: "false"`; closing those Sessions records
  // the process-state transition without closing the borrowed multiplexer.
  if (
    PANE_LIVE_STATUSES.has(session.status) &&
    session.muxRef.asem_mux_owned !== "false"
  ) {
    // Resolve the mux template through this cwd's config so a project-local
    // `close` sequence overrides the builtin for the Session's mux.
    const templateRegistry = deps.templateRegistryFactory.forConfig(config);
    // A malformed project-local template is a structured `invalid_template`
    // error surfaced before the status update; a missing one stays
    // `mux_template_not_found` (MIK-026).
    const muxResult = resolveMuxTemplate(templateRegistry, session.mux);
    if (!muxResult.ok) {
      return err(muxResult.error);
    }
    if (muxResult.value === undefined) {
      return err(
        operationError("mux_template_not_found", "mux template not found", {
          mux: session.mux,
        }),
      );
    }
    const muxTemplate: MuxTemplate = muxResult.value;

    const engine = new SequenceEngine({
      runner: deps.templateRunner,
      redactor,
      logger,
    });
    const result = await engine.run(muxTemplate.close, {
      cwd: session.cwd,
      variables: muxRefVars(session.muxRef),
    });
    if (!result.ok) {
      // Truthful: the pane may still be alive, so leave the status unchanged
      // and surface the structured error rather than claim a false close.
      logger?.warn("mux close failed", {
        sessionId: session.id,
        code: result.error.code,
      });
      return err(result.error);
    }
  }

  const closedAt = deps.clock.nowIso();
  await deps.store.updateSession(scope, session.id, {
    status: "closed",
    closedAt,
    updatedAt: closedAt,
  });
  logger?.info("closed Session", {
    sessionId: session.id,
    previousStatus: session.status,
  });
  return ok({
    session: {
      ...session,
      status: "closed",
      closedAt,
      updatedAt: closedAt,
    },
  });
}

/**
 * A redactor scoped to the current Session's raw token so it is masked from any
 * sequence error or log line. Human calls have no token, so fall back to the
 * injected redactor.
 */
function redactorFor(
  deps: { redactor?: Redactor },
  token: string | null,
): Redactor {
  if (token === null) {
    return deps.redactor ?? noopRedactor;
  }
  return createRedactor([token]);
}
