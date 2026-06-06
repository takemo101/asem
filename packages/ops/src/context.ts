/**
 * Shared resolution and auth helpers for `@asem/ops`.
 *
 * Config discovery, scope resolution, and current-Session authentication are
 * the cross-cutting concerns every scoped operation needs. They live here so
 * each handler composes them instead of re-deriving scope ad hoc (implementation
 * principle 7: scope every store query).
 */
import {
  type Config,
  type ConfigLoader,
  type CurrentSessionResolver,
  type EffectiveScope,
  err,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Session,
  type Store,
  verifyToken,
} from "@asem/core";
import type { OpContext } from "./deps.ts";

/** Config + scope resolved for a worktree, shared by scoped operations. */
export interface ProjectContext {
  config: Config;
  configPath: string;
  scope: EffectiveScope;
}

/**
 * Discover and parse `.asem.yaml` for `cwd`, then resolve Effective Scope.
 * Returns `config_not_found` / `invalid_config` so callers surface the right
 * structured error without inspecting the loader's internals.
 */
export async function resolveContext(
  deps: { configLoader: ConfigLoader; scopeResolver: ScopeResolver },
  cwd: string,
): Promise<OperationResult<ProjectContext>> {
  const discovery = await deps.configLoader.load(cwd);
  if (discovery.kind === "not_found") {
    return err(
      operationError(
        "config_not_found",
        "no .asem.yaml found; run `asem init` to create one",
        { cwd },
      ),
    );
  }
  if (discovery.kind === "invalid") {
    return err(
      operationError("invalid_config", "`.asem.yaml` could not be parsed", {
        configPath: discovery.configPath,
        issues: discovery.issues,
      }),
    );
  }
  const scope = await deps.scopeResolver.resolve(cwd, discovery.config);
  return ok({
    config: discovery.config,
    configPath: discovery.configPath,
    scope,
  });
}

/** True when two scopes refer to the same workspace + worktree. */
export function sameScope(a: EffectiveScope, b: EffectiveScope): boolean {
  return a.workspaceId === b.workspaceId && a.worktreeRoot === b.worktreeRoot;
}

/**
 * Resolve and verify the current Session for `scope`.
 *
 * Produces the full ladder of recoverable auth errors:
 * - `current_session_not_found` when no current-session pointer resolves;
 * - `scope_mismatch` when the pointer was registered in another scope;
 * - `session_not_found` when the referenced row is gone from this scope;
 * - `invalid_session_token` when the raw token fails to verify against the hash.
 *
 * Verification compares the raw token to the stored hash only; it never logs or
 * returns token material (implementation principle 8).
 */
export async function authenticateCurrentSession(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
): Promise<OperationResult<Session>> {
  const ref = await deps.currentSessionResolver.resolve(scope);
  if (ref === null) {
    return err(
      operationError(
        "current_session_not_found",
        "no current Session; run `asem init-session` or pass an explicit target",
      ),
    );
  }
  if (ref.scope !== undefined && !sameScope(ref.scope, scope)) {
    return err(
      operationError(
        "scope_mismatch",
        "current Session belongs to a different workspace or worktree",
        { sessionId: ref.sessionId },
      ),
    );
  }
  const session = await deps.store.getSessionById(scope, ref.sessionId);
  if (session === null) {
    return err(
      operationError(
        "session_not_found",
        "current Session is not registered in this scope",
        { sessionId: ref.sessionId },
      ),
    );
  }
  if (!verifyToken(ref.token, session.tokenHash)) {
    return err(
      operationError(
        "invalid_session_token",
        "current Session token failed verification",
        { sessionId: ref.sessionId },
      ),
    );
  }
  return ok(session);
}

/**
 * Enforce MCP/agent-origin auth when requested by the trusted surface context.
 *
 * Human CLI/TUI calls leave `origin` unset (or set `operator` for TUI sends) and
 * therefore keep local-trust behavior. MCP sets `origin: "agent"`, so every
 * scoped read/mutation that calls this helper requires a verified current
 * Session token before continuing.
 */
export async function authenticateAgentOrigin(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
  ctx: OpContext,
): Promise<OperationResult<Session | null>> {
  if (ctx.origin !== "agent") {
    return ok(null);
  }
  return authenticateCurrentSession(deps, scope);
}
