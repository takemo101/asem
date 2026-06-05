/**
 * Lightweight liveness refresh shared by `list_sessions` and `get_session`.
 *
 * Only Sessions that could still be live (`starting` / `running`) are probed,
 * and the probe reports process/connection state only — never work outcome
 * (implementation principle 12; CONTEXT.md). When the probe disagrees with the
 * stored status the row is updated and the refreshed Session is returned.
 */
import type {
  Clock,
  EffectiveScope,
  LivenessProbe,
  Session,
  Store,
} from "@asem/core";

type LivenessDeps = {
  store: Store;
  livenessProbe: LivenessProbe;
  clock: Clock;
};

/** Statuses that warrant a liveness probe; terminal states are left as-is. */
function isProbeable(status: Session["status"]): boolean {
  return status === "starting" || status === "running";
}

export async function refreshLiveness(
  deps: LivenessDeps,
  scope: EffectiveScope,
  session: Session,
): Promise<Session> {
  if (!isProbeable(session.status)) {
    return session;
  }
  const probed = await deps.livenessProbe.check(session);
  if (probed === session.status) {
    return session;
  }
  const updatedAt = deps.clock.nowIso();
  await deps.store.updateSession(scope, session.id, {
    status: probed,
    updatedAt,
  });
  return { ...session, status: probed, updatedAt };
}

export async function refreshLivenessAll(
  deps: LivenessDeps,
  scope: EffectiveScope,
  sessions: readonly Session[],
): Promise<Session[]> {
  const out: Session[] = [];
  for (const session of sessions) {
    out.push(await refreshLiveness(deps, scope, session));
  }
  return out;
}
