/**
 * Messages-tab projection and ephemeral new-message badges.
 *
 * Two concerns live together because both read the Message list for a Session:
 *
 * 1. **Messages tab** — the Session's related history (sent or received),
 *    chronological ascending, with a delivery-error marker (design "Messages tab
 *    row format"). Delivery state is read verbatim; the cockpit never fabricates
 *    ack/read state.
 * 2. **Badges** — counts of *incoming* Messages not yet observed, relative to an
 *    in-memory baseline. The baseline is seeded at TUI start (or the last
 *    observed point) and is never persisted, so badges are purely ephemeral
 *    (CONTEXT.md "Inbox"; design "TUI behavior").
 */
import type { Message, Session } from "@asem/core";
import type { MessageRow } from "./types.ts";

/** Messages where the Session is the sender or the recipient. */
export function relatedMessages(
  messages: Message[],
  sessionId: string,
): Message[] {
  return messages.filter(
    (m) => m.toSessionId === sessionId || m.fromSessionId === sessionId,
  );
}

/** Messages addressed *to* the Session (the badge-eligible set). */
export function incomingMessages(
  messages: Message[],
  sessionId: string,
): Message[] {
  return messages.filter((m) => m.toSessionId === sessionId);
}

function byCreatedThenId(a: Message, b: Message): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

/** `HH:MM` from a stored ISO timestamp, read positionally to avoid tz math. */
export function timeLabel(createdAt: string): string {
  const time = createdAt.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? time : createdAt;
}

/**
 * The durable failed-notification notice (spec "timeline ledger"). `failed`
 * means the pane notification failed while the Message remains stored; the
 * wording deliberately implies no Agent acceptance, no Message loss, no
 * acknowledgement, and no resend action.
 */
export const MESSAGE_FAILED_NOTICE =
  "Notification failed · Message is stored · no auto-resend";

/** Maximum characters of a collapsed entry's one-line body preview. */
export const MESSAGE_PREVIEW_MAX = 60;

/** One-line compact preview of a Message body, `…`-suffixed when it elides. */
export function messagePreviewLabel(body: string): string {
  const firstLine = body.split("\n", 1)[0] ?? "";
  const clipped = firstLine.slice(0, MESSAGE_PREVIEW_MAX);
  return clipped.length < body.length ? `${clipped}…` : clipped;
}

/** Presentation options for {@link messageRows}. */
export interface MessageRowsOptions {
  /**
   * Ids of ordinary Messages expanded through local UI state. Ephemeral only:
   * never persisted and never a read/unread receipt.
   */
  expandedMessageIds?: ReadonlySet<string>;
}

/**
 * Build the chronological-ascending Messages-tab rows for a Session, resolving
 * sender/recipient labels from the snapshot's Session names. A human-originated
 * Message (`from_session_id === null`) is labeled `external`. Report bodies are
 * expanded by default; ordinary Messages stay compact previews unless their id
 * is in `expandedMessageIds`.
 */
export function messageRows(
  messages: Message[],
  sessionId: string,
  sessions: Session[],
  options: MessageRowsOptions = {},
): MessageRow[] {
  const nameById = new Map(sessions.map((s) => [s.id, s.name]));
  const label = (id: string | null): string =>
    id === null ? "external" : (nameById.get(id) ?? id);
  const expandedIds = options.expandedMessageIds ?? new Set<string>();

  return relatedMessages(messages, sessionId)
    .slice()
    .sort(byCreatedThenId)
    .map((message) => {
      const direction = message.toSessionId === sessionId ? "in" : "out";
      return {
        message,
        timeLabel: timeLabel(message.createdAt),
        fromLabel: label(message.fromSessionId),
        toLabel: label(message.toSessionId),
        kind: message.kind,
        direction,
        counterpartLabel:
          direction === "in"
            ? label(message.fromSessionId)
            : label(message.toSessionId),
        expanded: message.kind === "report" || expandedIds.has(message.id),
        previewLabel: messagePreviewLabel(message.body),
        failedNoticeLabel:
          message.deliveryError === null ? null : MESSAGE_FAILED_NOTICE,
        delivered: message.deliveredAt !== null,
        deliveryError: message.deliveryError,
        hasDeliveryError: message.deliveryError !== null,
      };
    });
}

/** Seed a baseline from every Message id so nothing is "new" at TUI start. */
export function seedBaseline(messages: Message[]): Set<string> {
  return new Set(messages.map((m) => m.id));
}

/** Ids of incoming Messages for a Session not yet in the observed baseline. */
export function newIncomingMessageIds(
  messages: Message[],
  sessionId: string,
  baseline: ReadonlySet<string>,
): string[] {
  return incomingMessages(messages, sessionId)
    .filter((m) => !baseline.has(m.id))
    .map((m) => m.id);
}

/** New-incoming-message badge count for a Session relative to the baseline. */
export function badgeCount(
  messages: Message[],
  sessionId: string,
  baseline: ReadonlySet<string>,
): number {
  return newIncomingMessageIds(messages, sessionId, baseline).length;
}

/**
 * Fold a Session's currently-new incoming Messages into the baseline, returning
 * the next baseline set. This is how observing a Session (selecting it on the
 * Messages tab, or refreshing while it is open) clears its badge — without
 * touching the store.
 */
export function observeSession(
  messages: Message[],
  sessionId: string,
  baseline: ReadonlySet<string>,
): Set<string> {
  const next = new Set(baseline);
  for (const id of newIncomingMessageIds(messages, sessionId, baseline)) {
    next.add(id);
  }
  return next;
}
