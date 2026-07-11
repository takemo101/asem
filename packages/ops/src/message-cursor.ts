/**
 * Versioned opaque cursor for paginated Message listing (MIK-061; design
 * "Cursor-based Message listing").
 *
 * A cursor binds the Workspace, the normalized result-changing filter (an
 * Inbox view is resolved to its target Session ID before binding), and an
 * exclusive internal sequence position. Binding detects caller mistakes only:
 * every list/wait call independently resolves scope and authenticates before
 * comparing it, and nothing decoded here authorizes access — decoding yields
 * only the sequence position.
 */
import {
  err,
  type MessageListFilter,
  type OperationResult,
  ok,
  operationError,
} from "@asem/core";

/** Query identity a cursor is bound to; never authorization material. */
export interface MessageCursorBinding {
  workspaceId: string;
  /** Resolved target Session ID (explicit or from an Inbox view), if any. */
  toSessionId?: string;
  worktreeRoot?: string;
  undelivered?: true;
}

const CURSOR_VERSION = 1;

const PAYLOAD_KEYS = new Set([
  "v",
  "workspaceId",
  "toSessionId",
  "worktreeRoot",
  "undelivered",
  "afterSequence",
]);

/**
 * Normalize a Store-ready filter into the result-changing binding fields.
 * No-op spellings (`undelivered: false`, absent fields) collapse to omission so
 * result-identical queries share one cursor identity. Callers resolve
 * `inbox: true` to a `toSessionId` before binding.
 */
export function messageCursorBinding(
  workspaceId: string,
  filter: MessageListFilter | undefined,
): MessageCursorBinding {
  return {
    workspaceId,
    ...(filter?.toSessionId !== undefined
      ? { toSessionId: filter.toSessionId }
      : {}),
    ...(filter?.worktreeRoot !== undefined
      ? { worktreeRoot: filter.worktreeRoot }
      : {}),
    ...(filter?.undelivered === true ? { undelivered: true as const } : {}),
  };
}

/** Encode a binding plus an exclusive sequence position as opaque base64url. */
export function encodeMessageCursor(
  binding: MessageCursorBinding,
  afterSequence: number,
): string {
  const payload = { v: CURSOR_VERSION, ...binding, afterSequence };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function invalidCursor(reason: string): OperationResult<never> {
  return err(
    operationError("invalid_input", "invalid Message cursor", { reason }),
  );
}

/**
 * Decode a cursor and verify it matches the freshly resolved query identity.
 * Malformed, tampered, or mismatched cursors are `invalid_input`; a valid one
 * yields only the exclusive sequence position.
 */
export function decodeMessageCursor(
  cursor: string,
  binding: MessageCursorBinding,
): OperationResult<{ afterSequence: number }> {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return invalidCursor("cursor is not base64url");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return invalidCursor("cursor payload is not JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return invalidCursor("cursor payload is not an object");
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PAYLOAD_KEYS.has(key))) {
    return invalidCursor("cursor payload has unexpected fields");
  }
  if (record.v !== CURSOR_VERSION) {
    return invalidCursor("unsupported cursor version");
  }
  const afterSequence = record.afterSequence;
  if (
    typeof afterSequence !== "number" ||
    !Number.isInteger(afterSequence) ||
    afterSequence < 0
  ) {
    return invalidCursor("cursor sequence position is invalid");
  }
  if (
    record.workspaceId !== binding.workspaceId ||
    record.toSessionId !== binding.toSessionId ||
    record.worktreeRoot !== binding.worktreeRoot ||
    record.undelivered !== binding.undelivered
  ) {
    return invalidCursor("cursor does not match this query");
  }
  return ok({ afterSequence });
}
