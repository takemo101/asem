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
 * Tests exercise this with fake `@asem/ops` deps (the `@asem/ops` in-memory
 * fakes), never a real store, multiplexer, or agent.
 */
import type { Message, OperationResult, Session } from "@asem/core";
import {
  closeSession,
  deleteSession,
  listMessages,
  listSessions,
  type OpContext,
  type OpsDeps,
  sendMessage,
} from "@asem/ops";
import type { CockpitEffect, CockpitSnapshot } from "./types.ts";

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
 * Load the cockpit snapshot for the current Effective Scope via the shared
 * `list_sessions` and `list_messages` operations. An optional liveness pass
 * (`ctx.refreshLiveness`) refreshes process state without inferring outcome. Any
 * structured error from either read is propagated unchanged.
 */
export async function loadCockpitSnapshot(
  deps: SnapshotDeps,
  ctx: OpContext,
): Promise<OperationResult<CockpitSnapshot>> {
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
 * - `refresh` → reload the snapshot;
 * - `attach` / `quit` → host-local, no operation, surfaced for the host to act.
 */
export async function executeCockpitEffect(
  deps: EffectDeps,
  ctx: OpContext,
  effect: CockpitEffect,
): Promise<OperationResult<CockpitEffectOutcome>> {
  switch (effect.kind) {
    case "send": {
      const result = await sendMessage(
        deps,
        { toSessionId: effect.sessionId, body: effect.body },
        ctx,
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
      const result = await loadCockpitSnapshot(deps, ctx);
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
