/**
 * In-memory activity projection: diff two {@link CockpitSnapshot}s into a short
 * list of {@link ActivityItem}s for the cockpit's activity strip.
 *
 * Activity is *view state only* (design "In-memory activity strip"): items are
 * derived during refresh, capped, never persisted, and never become Messages,
 * Events, or unread receipts. A `status_changed` item reflects process/connection
 * state only — it is not a work outcome.
 */
import type { Message, MessageKind, SessionStatus } from "@asem/core";
import type { CockpitSnapshot } from "./types.ts";

/** Most recent activity rows kept in state (design: cap at 8–12). */
export const ACTIVITY_CAP = 12;

/** Delivery result of a Message, read verbatim from its delivery fields. */
export type DeliveryResult = "pending" | "delivered" | "error";

/** The delivery result a Message row currently records. */
export function deliveryResult(message: Message): DeliveryResult {
  if (message.deliveryError !== null) {
    return "error";
  }
  return message.deliveredAt !== null ? "delivered" : "pending";
}

/**
 * One ephemeral activity row. `at` is the ISO timestamp taken from the row that
 * produced the item (no clock dependency), used only for display.
 */
export type ActivityItem =
  | {
      kind: "session_added";
      sessionId: string;
      sessionName: string;
      worktreeRoot: string;
      at: string;
    }
  | {
      kind: "session_removed";
      sessionId: string;
      sessionName: string;
      worktreeRoot: string;
      at: string;
    }
  | {
      kind: "status_changed";
      sessionId: string;
      sessionName: string;
      worktreeRoot: string;
      from: SessionStatus;
      to: SessionStatus;
      at: string;
    }
  | {
      kind: "message_added";
      messageId: string;
      fromLabel: string;
      toLabel: string;
      messageKind: MessageKind;
      at: string;
    }
  | {
      kind: "delivery_changed";
      messageId: string;
      toLabel: string;
      result: DeliveryResult;
      deliveryError: string | null;
      at: string;
    };

/** Resolve a Session label from either snapshot (name, else id, else external). */
function sessionLabel(
  id: string | null,
  ...snapshots: CockpitSnapshot[]
): string {
  if (id === null) {
    return "external";
  }
  for (const snapshot of snapshots) {
    const found = snapshot.sessions.find((s) => s.id === id);
    if (found !== undefined) {
      return found.name;
    }
  }
  return id;
}

function sessionItems(
  prev: CockpitSnapshot,
  next: CockpitSnapshot,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const prevById = new Map(prev.sessions.map((s) => [s.id, s]));
  const nextIds = new Set(next.sessions.map((s) => s.id));

  for (const session of next.sessions) {
    const before = prevById.get(session.id);
    if (before === undefined) {
      items.push({
        kind: "session_added",
        sessionId: session.id,
        sessionName: session.name,
        worktreeRoot: session.worktreeRoot,
        at: session.createdAt,
      });
    } else if (before.status !== session.status) {
      items.push({
        kind: "status_changed",
        sessionId: session.id,
        sessionName: session.name,
        worktreeRoot: session.worktreeRoot,
        from: before.status,
        to: session.status,
        at: session.updatedAt,
      });
    }
  }
  for (const session of prev.sessions) {
    if (!nextIds.has(session.id)) {
      items.push({
        kind: "session_removed",
        sessionId: session.id,
        sessionName: session.name,
        worktreeRoot: session.worktreeRoot,
        at: session.updatedAt,
      });
    }
  }
  return items;
}

function messageItems(
  prev: CockpitSnapshot,
  next: CockpitSnapshot,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const prevById = new Map(prev.messages.map((m) => [m.id, m]));

  for (const message of next.messages) {
    const before = prevById.get(message.id);
    if (before === undefined) {
      items.push({
        kind: "message_added",
        messageId: message.id,
        fromLabel: sessionLabel(message.fromSessionId, next, prev),
        toLabel: sessionLabel(message.toSessionId, next, prev),
        messageKind: message.kind,
        at: message.createdAt,
      });
    } else if (deliveryResult(before) !== deliveryResult(message)) {
      items.push({
        kind: "delivery_changed",
        messageId: message.id,
        toLabel: sessionLabel(message.toSessionId, next, prev),
        result: deliveryResult(message),
        deliveryError: message.deliveryError,
        at: message.deliveredAt ?? message.createdAt,
      });
    }
  }
  return items;
}

/**
 * Diff two snapshots into activity items, in stable order: Session changes
 * (added / status / removed, in snapshot order) then Message changes (added /
 * delivery). An unchanged snapshot yields an empty list.
 */
export function diffSnapshots(
  prev: CockpitSnapshot,
  next: CockpitSnapshot,
): ActivityItem[] {
  return [...sessionItems(prev, next), ...messageItems(prev, next)];
}

/**
 * Append freshly diffed items to the existing activity list, keeping only the
 * latest {@link ACTIVITY_CAP} rows (oldest rows fall off the front).
 */
export function appendActivity(
  activity: readonly ActivityItem[],
  items: readonly ActivityItem[],
): readonly ActivityItem[] {
  if (items.length === 0) {
    return activity;
  }
  return [...activity, ...items].slice(-ACTIVITY_CAP);
}

/**
 * Session ids with a `session_added` row still in the capped activity list —
 * the ephemeral "new Session" row markers (design "Selection and workspace
 * grouping": markers are view state, not persistent state).
 */
export function newSessionIds(
  activity: readonly ActivityItem[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of activity) {
    if (item.kind === "session_added") {
      ids.add(item.sessionId);
    }
  }
  return ids;
}
