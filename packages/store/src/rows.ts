/**
 * Row mapping between SQLite rows and typed `@asem/core` domain values.
 *
 * Per implementation principle 1 (parse, don't merely check) the store never
 * hands raw untyped rows to callers: every read is parsed through the canonical
 * `@asem/core` schemas. A row that fails to parse is treated as corruption and
 * surfaced as a {@link StoreError} with code `row_parse_failed`.
 */
import type { SQLQueryBindings } from "bun:sqlite";
import {
  type Message,
  messageSchema,
  type Session,
  sessionSchema,
} from "@asem/core";
import { StoreError } from "./errors.ts";

/** Raw `sessions` row shape as returned by SQLite. */
export interface SessionRow {
  id: unknown;
  workspace_id: unknown;
  worktree_root: unknown;
  name: unknown;
  cwd: unknown;
  agent: unknown;
  mux: unknown;
  parent_session_id: unknown;
  status: unknown;
  mux_ref_json: unknown;
  session_dir: unknown;
  token_hash: unknown;
  created_at: unknown;
  updated_at: unknown;
  closed_at: unknown;
}

/** Raw `messages` row shape as returned by SQLite. */
export interface MessageRow {
  id: unknown;
  workspace_id: unknown;
  worktree_root: unknown;
  from_session_id: unknown;
  to_session_id: unknown;
  kind: unknown;
  body: unknown;
  formatted_body: unknown;
  delivered_at: unknown;
  delivery_error: unknown;
  created_at: unknown;
}

function parseMuxRefJson(raw: unknown, id: unknown): unknown {
  if (typeof raw !== "string") {
    throw new StoreError(
      "row_parse_failed",
      "sessions.mux_ref_json is not stored as text",
      { id },
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new StoreError(
      "row_parse_failed",
      "sessions.mux_ref_json is not valid JSON",
      { id },
    );
  }
}

/** Parse a raw `sessions` row into a typed {@link Session}. */
export function parseSessionRow(row: SessionRow): Session {
  const candidate = {
    id: row.id,
    workspaceId: row.workspace_id,
    worktreeRoot: row.worktree_root,
    name: row.name,
    cwd: row.cwd,
    agent: row.agent,
    mux: row.mux,
    parentSessionId: row.parent_session_id ?? null,
    status: row.status,
    muxRef: parseMuxRefJson(row.mux_ref_json, row.id),
    sessionDir: row.session_dir,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? null,
  };
  const parsed = sessionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StoreError(
      "row_parse_failed",
      "sessions row failed schema validation",
      { id: row.id, issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

/** Parse a raw `messages` row into a typed {@link Message}. */
export function parseMessageRow(row: MessageRow): Message {
  const candidate = {
    id: row.id,
    workspaceId: row.workspace_id,
    worktreeRoot: row.worktree_root,
    fromSessionId: row.from_session_id ?? null,
    toSessionId: row.to_session_id,
    kind: row.kind,
    body: row.body,
    formattedBody: row.formatted_body,
    deliveredAt: row.delivered_at ?? null,
    deliveryError: row.delivery_error ?? null,
    createdAt: row.created_at,
  };
  const parsed = messageSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new StoreError(
      "row_parse_failed",
      "messages row failed schema validation",
      { id: row.id, issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

/** Positional values for a `sessions` insert, in column order. */
export function sessionInsertValues(session: Session): SQLQueryBindings[] {
  return [
    session.id,
    session.workspaceId,
    session.worktreeRoot,
    session.name,
    session.cwd,
    session.agent,
    session.mux,
    session.parentSessionId,
    session.status,
    JSON.stringify(session.muxRef),
    session.sessionDir,
    session.tokenHash,
    session.createdAt,
    session.updatedAt,
    session.closedAt,
  ];
}

/** Positional values for a `messages` insert, in column order. */
export function messageInsertValues(message: Message): SQLQueryBindings[] {
  return [
    message.id,
    message.workspaceId,
    message.worktreeRoot,
    message.fromSessionId,
    message.toSessionId,
    message.kind,
    message.body,
    message.formattedBody,
    message.deliveredAt,
    message.deliveryError,
    message.createdAt,
  ];
}
