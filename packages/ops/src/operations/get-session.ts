/**
 * `get_session` operation — read one Session in the current Effective Scope.
 *
 * The scoped Store lookup means a Session in another worktree is reported as
 * `session_not_found`, not leaked across the isolation boundary (ADR 0002). An
 * optional liveness pass may refresh process state without inferring work
 * outcome.
 *
 * For human/operator surfaces, `get_session` also surfaces an `attachHint`: the
 * attach command rendered from the Session's mux template `attach` sequence and
 * its captured mux refs. This shared `@asem/ops`/`@asem/runtime` path means the
 * CLI and TUI render the same hint instead of re-deriving attach commands from
 * raw mux coordinates. Attach stays human-only — the hint is a string, never an
 * executed mux binary, and there is no `attach_session` MCP tool. When the mux
 * template defines no attach commands (or the captured refs are incomplete), no
 * hint is surfaced and the surface falls back to safe manual guidance.
 */
import {
  type Clock,
  type Config,
  type ConfigLoader,
  err,
  type GetSessionInput,
  type GetSessionOutput,
  getSessionInputSchema,
  type LivenessProbe,
  type MuxRef,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Session,
  type Store,
  type TemplateRegistryFactory,
} from "@asem/core";
import { muxTemplateSchema, renderAttachHint } from "@asem/runtime";
import { resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { refreshLiveness } from "./liveness.ts";

type GetSessionDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  templateRegistryFactory: TemplateRegistryFactory;
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
  const { config, scope } = contextResult.value;

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

  const attachHint = resolveAttachHint(deps, config, session);

  return ok({ session, ...(attachHint !== undefined ? { attachHint } : {}) });
}

/**
 * Render the operator attach hint for `session` from its mux template's `attach`
 * sequence and captured mux refs. Returns `undefined` when the mux template is
 * unknown, defines no attach commands, or the captured refs are missing a
 * variable the attach commands reference — the surface then falls back to safe
 * manual guidance. The template registry is built from the resolved config so
 * project-local mux templates resolve through the same path as builtins.
 */
function resolveAttachHint(
  deps: Pick<GetSessionDeps, "templateRegistryFactory">,
  config: Config,
  session: Session,
): string | undefined {
  const rawMux = deps.templateRegistryFactory
    .forConfig(config)
    .getMuxTemplate(session.mux);
  if (rawMux === undefined || rawMux === null) {
    return undefined;
  }
  const muxTemplate = muxTemplateSchema.parse(rawMux);
  return renderAttachHint(muxTemplate.attach, attachVars(session));
}

/**
 * Interpolation variables for the attach sequence: the Session's captured mux
 * refs (the addressable pane/tab coordinates) plus a few Session-derived
 * conveniences, mirroring how `create_session` layers refs over base vars. Mux
 * refs win on key collision since they carry the live coordinates.
 */
function attachVars(session: Session): Record<string, string> {
  return {
    session_id: session.id,
    name: session.name,
    cwd: session.cwd,
    worktree_root: session.worktreeRoot,
    workspace_id: session.workspaceId,
    agent: session.agent,
    mux: session.mux,
    session_dir: session.sessionDir,
    ...stringifyMuxRef(session.muxRef),
  };
}

/** Coerce a stored {@link MuxRef} (`Record<string, unknown>`) to string values. */
function stringifyMuxRef(muxRef: MuxRef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(muxRef)) {
    if (typeof value === "string") {
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}
