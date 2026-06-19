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
 * Discover and parse `.asem.yaml` for `configCwd`, then resolve Effective Scope.
 * Returns `config_not_found` / `invalid_config` so callers surface the right
 * structured error without inspecting the loader's internals.
 *
 * `scopeCwd` defaults to `configCwd`, so the common case discovers config and
 * resolves scope from the same directory. They differ only for the CLI repo-alias
 * seam (`session create --repo <alias>`): config is pinned to the alias-declaring
 * root while scope/launch target the resolved repo path (design "Repo alias
 * creation from a workspace root").
 */
export async function resolveContext(
  deps: { configLoader: ConfigLoader; scopeResolver: ScopeResolver },
  configCwd: string,
  scopeCwd: string = configCwd,
): Promise<OperationResult<ProjectContext>> {
  const discovery = await deps.configLoader.load(configCwd);
  if (discovery.kind === "not_found") {
    return err(
      operationError(
        "config_not_found",
        "no .asem.yaml found; run `asem init` to create one",
        { cwd: configCwd },
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
  const scope = await deps.scopeResolver.resolve(scopeCwd, discovery.config);
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

/** A verified current Session paired with the raw token that authenticated it. */
export interface VerifiedCurrentSession {
  session: Session;
  token: string;
}

/**
 * Resolve and verify the current Session for `scope`, returning both the Session
 * and the raw token that authenticated it.
 *
 * Produces the full ladder of recoverable auth errors:
 * - `current_session_not_found` when no current-session pointer resolves;
 * - `scope_mismatch` when the pointer was registered in another scope;
 * - `session_not_found` when the referenced row is gone from this scope;
 * - `invalid_session_token` when the raw token fails to verify against the hash.
 *
 * The raw token is returned only so mutating operations can scope a redactor to
 * it (principle 8); verification still compares it to the stored hash only and
 * never logs it. {@link authenticateCurrentSession} delegates here and keeps the
 * Session-only return type for read/report callers that need no token material.
 */
export async function authenticateCurrentSessionWithToken(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
): Promise<OperationResult<VerifiedCurrentSession>> {
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
  return ok({ session, token: ref.token });
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
  const auth = await authenticateCurrentSessionWithToken(deps, scope);
  if (!auth.ok) {
    return auth;
  }
  return ok(auth.value.session);
}

/**
 * The trust outcome of a mutating operation that allows human local trust.
 *
 * The variant carries exactly the material the operation may use: a verified
 * Session for attribution and a raw token for redaction when the actor is a real
 * Session, or neither when the operation runs under operator/anonymous local
 * trust. Modeling all four cases here keeps ADR 0003 origin semantics in one
 * place instead of re-deriving the ladder in send/close/delete.
 */
export type MutationActor =
  | { kind: "operator"; session: null; token: null }
  | { kind: "human-anon"; session: null; token: null }
  | { kind: "human-current"; session: Session; token: string }
  | { kind: "agent"; session: Session; token: string };

/**
 * Resolve the trusted actor for a mutating operation that permits human local
 * trust (send/close/delete), centralizing the ADR 0003 origin ladder:
 *
 * - `operator` (TUI human surface): never resolves or authenticates a current
 *   Session, so a workspace-scope action into a sibling worktree is not silently
 *   attributed to that worktree's current-Session pointer;
 * - `agent` (MCP): requires and verifies the current Session;
 * - unset (CLI/direct human): if a current-Session pointer is present it is
 *   verified (`human-current`); if none resolves the action proceeds under
 *   anonymous local trust (`human-anon`).
 *
 * The returned token is the raw current-Session token, exposed only so callers
 * can scope a redactor to it; it is never logged or persisted (principle 8).
 *
 * `report_parent` does not use this helper: it is always the verified current
 * Session and must not gain an optional/anonymous actor path (ADR 0003).
 */
export async function resolveMutationActor(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
  ctx: OpContext,
): Promise<OperationResult<MutationActor>> {
  if (ctx.origin === "operator") {
    return ok({ kind: "operator", session: null, token: null });
  }
  if (ctx.origin === "agent") {
    const auth = await authenticateCurrentSessionWithToken(deps, scope);
    if (!auth.ok) {
      return auth;
    }
    return ok({
      kind: "agent",
      session: auth.value.session,
      token: auth.value.token,
    });
  }

  const ref = await deps.currentSessionResolver.resolve(scope);
  if (ref === null) {
    return ok({ kind: "human-anon", session: null, token: null });
  }
  const auth = await authenticateCurrentSessionWithToken(deps, scope);
  if (!auth.ok) {
    return auth;
  }
  return ok({
    kind: "human-current",
    session: auth.value.session,
    token: auth.value.token,
  });
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
