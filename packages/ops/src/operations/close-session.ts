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
 * The target is resolved by Workspace-scoped Store lookup, so a Session in a
 * sibling worktree under the same Workspace can be closed while Sessions in
 * another Workspace remain `session_not_found` (ADR 0008). Mux `close` is
 * invoked through `@asem/runtime` only when a live pane could exist
 * (`starting`/`running`); a Session that already `exited`,
 * is `missing`, or is `closed` has no live pane to control, so close records the
 * truth without pretending to kill a process it did not.
 *
 * Truthfulness over optimism: if the mux `close` sequence fails, the pane may
 * still be alive, so the operation returns the structured sequence error and
 * leaves the stored status unchanged rather than falsely marking the Session
 * `closed`. `force: true` is the explicit recovery escape hatch for known-stale
 * live Sessions whose mux resource has already disappeared; it records `closed`
 * while preserving Message/Report history. No delivery/read/ack state is invented
 * anywhere in this path.
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
  shellEscape,
  type TemplateRegistryFactory,
  type TemplateRunner,
} from "@asem/core";
import type { MuxTemplate } from "@asem/runtime";
import { resolveContext, resolveMutationActor } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { muxExecutionFor } from "../mux-execution.ts";
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

function muxCloseWarningFor(session: {
  mux: string;
  muxRef: Record<string, unknown>;
}): CloseSessionOutput["muxCloseWarning"] | undefined {
  if (session.mux !== "herdr") {
    return {
      message:
        "mux close failed; the Multiplexer resource may still exist because --force marked only the Session closed",
    };
  }

  const herdrSession = session.muxRef.herdr_session;
  const workspaceId = session.muxRef.herdr_workspace_id;
  if (typeof herdrSession !== "string" || typeof workspaceId !== "string") {
    return {
      message:
        "mux close failed; Herdr workspace may still exist because --force marked only the Session closed",
    };
  }

  return {
    message:
      "mux close failed; Herdr workspace may still exist because --force marked only the Session closed",
    cleanupCommand: `herdr --session ${shellEscape(herdrSession)} workspace close ${shellEscape(workspaceId)}`,
  };
}

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

  // Auth: the actor ladder (ADR 0003) lives in resolveMutationActor. Agent
  // origin verifies the current Session; an operator surface (TUI) forces local
  // trust so a stale current-session pointer in the target scope cannot block
  // the close; unset origin verifies a present pointer or closes under anonymous
  // local trust. Close performs no attribution — only the token is used, to
  // scope the mux redactor.
  const actorResult = await resolveMutationActor(deps, scope, ctx);
  if (!actorResult.ok) {
    return actorResult;
  }
  const actor = actorResult.value;

  // Scoped lookup enforces the Workspace boundary; sibling-worktree Sessions
  // inside the same Workspace are addressable, but other Workspaces are not.
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

  // One token-scoped redactor + redacted logger + SequenceEngine, so the current
  // Session's raw token is masked from any sequence error or log line
  // (principle 8). Operator/anonymous closes have no token and fall back to the
  // injected redactor.
  const { logger, engine } = muxExecutionFor(deps, actor.token);

  // Mux `close` runs only when a live pane could exist and asem owns the mux
  // resource. Sessions registered through `init-session` borrow an existing
  // pane/workspace (notably the operator's current herdr workspace), so their
  // mux ref carries `asem_mux_owned: "false"`; closing those Sessions records
  // the process-state transition without closing the borrowed multiplexer.
  let muxCloseWarning: CloseSessionOutput["muxCloseWarning"] | undefined;

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

    const result = await engine.run(muxTemplate.close, {
      cwd: session.cwd,
      variables: muxRefVars(session.muxRef),
    });
    if (!result.ok) {
      logger?.warn("mux close failed", {
        sessionId: session.id,
        code: result.error.code,
        force: input.force === true,
      });
      if (input.force !== true) {
        // Truthful by default: the pane may still be alive, so leave the status
        // unchanged and surface the structured error rather than claim a false
        // close. Callers must opt into force for known-stale mux refs.
        return err(result.error);
      }
      muxCloseWarning = muxCloseWarningFor(session);
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
    ...(muxCloseWarning !== undefined ? { muxCloseWarning } : {}),
  });
}
