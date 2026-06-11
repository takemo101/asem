/**
 * The cockpit's edge: where the pure view-model meets `@asem/ops`.
 *
 * The functional core (`view-model.ts`) is I/O-free; this module is the thin
 * shell that turns a refresh into a snapshot and a {@link CockpitEffect} into the
 * matching shared operation. It duplicates no semantics — every behavior is an
 * `@asem/ops` handler call — so the TUI stays a surface projection (architecture
 * rule). Operator local-trust means send/close/delete are dispatched without a
 * Session token; the destructive ones only arrive here after the view-model's
 * confirmation gate, and `delete` is sent with `force: true` accordingly.
 *
 * Scope: in `worktree` mode every read uses the worktree-isolated
 * `list_sessions` / `list_messages`. In `workspace` mode the snapshot is the
 * workspace-wide `load_workspace_snapshot`, and cross-worktree effects are run
 * against the target Session's own worktree (the caller picks the `cwd`); the
 * scope broadening stays confined to those reads (implementation principle 7).
 *
 * Tests exercise this with fake `@asem/ops` deps (the `@asem/ops` in-memory
 * fakes), never a real store, multiplexer, or agent.
 */
import type { AttachCommand, Message, OperationResult, Session } from "@asem/core";
import {
  closeSession,
  deleteSession,
  getSession,
  listMessages,
  listSessions,
  loadWorkspaceSnapshot,
  type OpContext,
  type OpsDeps,
  resolveContext,
  sendMessage,
} from "@asem/ops";
import type {
  CockpitEffect,
  CockpitEnv,
  CockpitScopeMode,
  CockpitSnapshot,
} from "./types.ts";

/** Ports the snapshot loader needs (a subset of {@link OpsDeps}). */
export type SnapshotDeps = Pick<
  OpsDeps,
  | "store"
  | "configLoader"
  | "scopeResolver"
  | "currentSessionResolver"
  | "livenessProbe"
  | "clock"
>;

/**
 * Load the cockpit snapshot for the current scope. In `worktree` mode this is
 * the worktree-isolated `list_sessions` / `list_messages`; in `workspace` mode
 * it is the workspace-wide `load_workspace_snapshot`, whose rows the view-model
 * groups by `worktree_root`. An optional liveness pass (`ctx.refreshLiveness`)
 * refreshes process state without inferring outcome. Any structured error from
 * the underlying reads is propagated unchanged.
 */
export async function loadCockpitSnapshot(
  deps: SnapshotDeps,
  ctx: OpContext,
  scopeMode: CockpitScopeMode = "worktree",
): Promise<OperationResult<CockpitSnapshot>> {
  if (scopeMode === "workspace") {
    const snapshot = await loadWorkspaceSnapshot(deps, ctx);
    return snapshot.ok
      ? {
          ok: true,
          value: {
            sessions: snapshot.value.sessions,
            messages: snapshot.value.messages,
          },
        }
      : snapshot;
  }

  const sessions = await listSessions(deps, { filter: undefined }, ctx);
  if (!sessions.ok) {
    return sessions;
  }
  const messages = await listMessages(deps, { filter: undefined }, ctx);
  if (!messages.ok) {
    return messages;
  }
  return {
    ok: true,
    value: {
      sessions: sessions.value.sessions,
      messages: messages.value.messages,
    },
  };
}

/** Ports the attach-hint loader needs (the `get_session` read subset). */
export type AttachDeps = Pick<
  OpsDeps,
  | "store"
  | "configLoader"
  | "scopeResolver"
  | "currentSessionResolver"
  | "templateRegistryFactory"
  | "livenessProbe"
  | "clock"
>;

/**
 * Load the operator attach hint for a Session through `get_session` — the same
 * shared `@asem/ops` path the CLI uses, so the TUI hands the host the *same*
 * hint instead of re-deriving attach commands. Returns `null` when no hint is
 * available (unknown Session, no attach template, or incomplete mux refs) so the
 * host falls back to safe manual guidance. A failed read (e.g. the Session was
 * removed) is treated as "no hint" — attach is best-effort operator guidance.
 */
export async function loadAttach(
  deps: AttachDeps,
  ctx: OpContext,
  sessionId: string,
): Promise<{ attachHint: string | null; attachCommand: AttachCommand | null }> {
  const result = await getSession(deps, { id: sessionId }, ctx);
  return result.ok
    ? {
        attachHint: result.value.attachHint ?? null,
        attachCommand: result.value.attachCommand ?? null,
      }
    : { attachHint: null, attachCommand: null };
}

/** Deps the cockpit env resolver needs (config + scope discovery). */
export type EnvDeps = Pick<OpsDeps, "configLoader" | "scopeResolver">;

/**
 * Resolve the immutable {@link CockpitEnv} for a `cwd` and scope mode from the
 * project context: scope identifiers, config path, and the config-derived mux /
 * agent defaults shown on the Context tab. Surfaces `config_not_found` /
 * `invalid_config` unchanged so the host can report them like any other CLI
 * error.
 */
export async function resolveCockpitEnv(
  deps: EnvDeps,
  cwd: string,
  scopeMode: CockpitScopeMode,
): Promise<OperationResult<CockpitEnv>> {
  const contextResult = await resolveContext(deps, cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, configPath, scope } = contextResult.value;
  return {
    ok: true,
    value: {
      scopeMode,
      workspaceId: scope.workspaceId,
      worktreeRoot: scope.worktreeRoot,
      cwd,
      configPath,
      defaultMux: config.mux.default,
      defaultAgent: config.agent.default,
    },
  };
}

/** Outcome of carrying out a {@link CockpitEffect}. */
export type CockpitEffectOutcome =
  | { kind: "sent"; message: Message }
  | { kind: "closed"; session: Session }
  | { kind: "deleted"; deletedSessionId: string; deletedMessageCount: number }
  | { kind: "refreshed"; snapshot: CockpitSnapshot }
  | { kind: "attach"; sessionId: string }
  | { kind: "quit" };

/** Ports needed to carry out effects (snapshot reads plus the mutations). */
export type EffectDeps = OpsDeps;

/**
 * Carry out a {@link CockpitEffect} against `@asem/ops`.
 *
 * - `send` → `send_message` (operator local trust, no source attribution);
 * - `close` → `close_session`;
 * - `delete` → `delete_session` with `force: true` (the view-model already
 *   required confirmation);
 * - `refresh` → reload the snapshot (honoring `scopeMode`);
 * - `attach` / `quit` → host-local, no operation, surfaced for the host to act.
 *
 * `ctx.cwd` selects the Effective Scope the mutation runs in. In `workspace`
 * mode the caller sets it to the target Session's worktree root so cross-worktree
 * operations resolve to the right scope.
 */
export async function executeCockpitEffect(
  deps: EffectDeps,
  ctx: OpContext,
  effect: CockpitEffect,
  scopeMode: CockpitScopeMode = "worktree",
): Promise<OperationResult<CockpitEffectOutcome>> {
  switch (effect.kind) {
    case "send": {
      // The TUI is the human operator surface (local trust). Mark the send
      // operator-originated so it is recorded with no source attribution and
      // never adopts the target worktree's current-Session pointer — in
      // workspace scope `ctx.cwd` is the sibling worktree's root, whose own
      // current Session must not be impersonated (MIK-022; ADR 0003).
      const result = await sendMessage(
        deps,
        { toSessionId: effect.sessionId, body: effect.body },
        { ...ctx, origin: "operator" },
      );
      return result.ok
        ? { ok: true, value: { kind: "sent", message: result.value.message } }
        : result;
    }
    case "close": {
      const result = await closeSession(deps, { id: effect.sessionId }, ctx);
      return result.ok
        ? { ok: true, value: { kind: "closed", session: result.value.session } }
        : result;
    }
    case "delete": {
      const result = await deleteSession(
        deps,
        { id: effect.sessionId, force: true },
        ctx,
      );
      return result.ok
        ? {
            ok: true,
            value: {
              kind: "deleted",
              deletedSessionId: result.value.deletedSessionId,
              deletedMessageCount: result.value.deletedMessageCount,
            },
          }
        : result;
    }
    case "refresh": {
      const result = await loadCockpitSnapshot(deps, ctx, scopeMode);
      return result.ok
        ? { ok: true, value: { kind: "refreshed", snapshot: result.value } }
        : result;
    }
    case "attach":
      return {
        ok: true,
        value: { kind: "attach", sessionId: effect.sessionId },
      };
    case "quit":
      return { ok: true, value: { kind: "quit" } };
    default: {
      const _never: never = effect;
      return _never;
    }
  }
}
