/**
 * SQLite-backed implementation of the `@asem/core` {@link Store} port.
 *
 * Responsibilities (and only these): migrations, row mapping, scoped CRUD for
 * Sessions and Messages, and scoped transaction primitives. The store never
 * decides use-case semantics — e.g. *when* a delete should also remove related
 * Messages. It exposes `deleteSessionScoped`, `deleteRelatedMessagesScoped`,
 * and `withTransaction` so `@asem/ops` can compose those decisions.
 *
 * Every normal query is scoped by Workspace (`workspace_id`) per ADR 0008.
 * `worktree_root` remains stored location metadata for grouping, filters, and
 * execution context; it is not the normal parent/message/report boundary.
 */

import type { SQLQueryBindings } from "bun:sqlite";
import { Database } from "bun:sqlite";
import type {
  EffectiveScope,
  Message,
  MessageListFilter,
  MessagePage,
  MessagePageQuery,
  Session,
  SessionListFilter,
  SessionUpdate,
  Store,
} from "@asem/core";
import { StoreError } from "./errors.ts";
import { migrate } from "./migrations.ts";
import {
  type MessageRow,
  messageInsertValues,
  parseMessageRow,
  parseSessionRow,
  parseStoredMessageRow,
  type SessionRow,
  sessionInsertValues,
} from "./rows.ts";

const INSERT_SESSION = `
  insert into sessions (
    id, workspace_id, worktree_root, name, cwd, agent, mux, model,
    profile, profile_source,
    parent_session_id, status, mux_ref_json, session_dir, token_hash,
    created_at, updated_at, closed_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const INSERT_MESSAGE = `
  insert into messages (
    id, workspace_id, worktree_root, from_session_id, to_session_id,
    kind, body, formatted_body, delivered_at, delivery_error, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/** Detect a violation of the unique Session-name-per-scope index. */
function isSessionNameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // SQLite reports e.g.
  //   "UNIQUE constraint failed: sessions.workspace_id, sessions.worktree_root, sessions.name"
  return message.includes("UNIQUE") && message.includes("sessions.name");
}

export class SqliteStore implements Store {
  private readonly db: Database;
  private inTransaction = false;

  /**
   * Wrap an existing connection. Runs migrations immediately so the store is
   * usable on return. Accepting a `Database` keeps the SQLite connection a
   * replaceable seam and lets tests inspect or seed the raw DB.
   */
  constructor(db: Database) {
    this.db = db;
    migrate(this.db);
  }

  // --- Sessions -----------------------------------------------------------

  async insertSession(session: Session): Promise<void> {
    try {
      this.db.query(INSERT_SESSION).run(...sessionInsertValues(session));
    } catch (error) {
      if (isSessionNameConflict(error)) {
        throw new StoreError(
          "session_name_conflict",
          "a Session with this name already exists in scope",
          {
            workspaceId: session.workspaceId,
            worktreeRoot: session.worktreeRoot,
            name: session.name,
          },
        );
      }
      throw error;
    }
  }

  async getSessionById(
    scope: EffectiveScope,
    id: string,
  ): Promise<Session | null> {
    const row = this.db
      .query(
        `select * from sessions
         where workspace_id = ? and id = ?`,
      )
      .get(scope.workspaceId, id) as SessionRow | null;
    return row ? parseSessionRow(row) : null;
  }

  async getSessionByName(
    scope: EffectiveScope,
    name: string,
  ): Promise<Session | null> {
    const row = this.db
      .query(
        `select * from sessions
         where workspace_id = ? and name = ?`,
      )
      .get(scope.workspaceId, name) as SessionRow | null;
    return row ? parseSessionRow(row) : null;
  }

  async listSessions(
    scope: EffectiveScope,
    filter?: SessionListFilter,
  ): Promise<Session[]> {
    const clauses = ["workspace_id = ?"];
    const params: SQLQueryBindings[] = [scope.workspaceId];

    if (filter?.status !== undefined) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.worktreeRoot !== undefined) {
      clauses.push("worktree_root = ?");
      params.push(filter.worktreeRoot);
    }
    if (filter && filter.parentSessionId !== undefined) {
      if (filter.parentSessionId === null) {
        clauses.push("parent_session_id is null");
      } else {
        clauses.push("parent_session_id = ?");
        params.push(filter.parentSessionId);
      }
    }

    const rows = this.db
      .query(
        `select * from sessions
         where ${clauses.join(" and ")}
         order by worktree_root asc, created_at asc, id asc`,
      )
      .all(...params) as SessionRow[];
    return rows.map(parseSessionRow);
  }

  async listSessionsByWorkspace(
    workspaceId: string,
    filter?: SessionListFilter,
  ): Promise<Session[]> {
    const clauses = ["workspace_id = ?"];
    const params: SQLQueryBindings[] = [workspaceId];

    if (filter?.status !== undefined) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.worktreeRoot !== undefined) {
      clauses.push("worktree_root = ?");
      params.push(filter.worktreeRoot);
    }
    if (filter && filter.parentSessionId !== undefined) {
      if (filter.parentSessionId === null) {
        clauses.push("parent_session_id is null");
      } else {
        clauses.push("parent_session_id = ?");
        params.push(filter.parentSessionId);
      }
    }

    const rows = this.db
      .query(
        `select * from sessions
         where ${clauses.join(" and ")}
         order by worktree_root asc, created_at asc, id asc`,
      )
      .all(...params) as SessionRow[];
    return rows.map(parseSessionRow);
  }

  async updateSession(
    scope: EffectiveScope,
    id: string,
    patch: SessionUpdate,
  ): Promise<void> {
    const sets: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.muxRef !== undefined) {
      sets.push("mux_ref_json = ?");
      params.push(JSON.stringify(patch.muxRef));
    }
    if (patch.updatedAt !== undefined) {
      sets.push("updated_at = ?");
      params.push(patch.updatedAt);
    }
    if (patch.closedAt !== undefined) {
      sets.push("closed_at = ?");
      params.push(patch.closedAt);
    }
    if (sets.length === 0) {
      return;
    }

    params.push(scope.workspaceId, id);
    this.db
      .query(
        `update sessions set ${sets.join(", ")}
         where workspace_id = ? and id = ?`,
      )
      .run(...params);
  }

  async deleteSessionScoped(scope: EffectiveScope, id: string): Promise<void> {
    this.db
      .query(
        `delete from sessions
         where workspace_id = ? and id = ?`,
      )
      .run(scope.workspaceId, id);
  }

  async orphanChildSessionsScoped(
    scope: EffectiveScope,
    parentSessionId: string,
  ): Promise<number> {
    const result = this.db
      .query(
        `update sessions set parent_session_id = null
         where workspace_id = ? and parent_session_id = ?`,
      )
      .run(scope.workspaceId, parentSessionId);
    return Number(result.changes);
  }

  async deleteRelatedMessagesScoped(
    scope: EffectiveScope,
    sessionId: string,
  ): Promise<number> {
    const result = this.db
      .query(
        `delete from messages
         where workspace_id = ?
           and (from_session_id = ? or to_session_id = ?)`,
      )
      .run(scope.workspaceId, sessionId, sessionId);
    return Number(result.changes);
  }

  // --- Messages -----------------------------------------------------------

  async insertMessage(message: Message): Promise<void> {
    this.db.query(INSERT_MESSAGE).run(...messageInsertValues(message));
  }

  async listMessages(
    scope: EffectiveScope,
    filter?: MessageListFilter,
  ): Promise<Message[]> {
    const clauses = ["workspace_id = ?"];
    const params: SQLQueryBindings[] = [scope.workspaceId];

    if (filter?.toSessionId !== undefined) {
      clauses.push("to_session_id = ?");
      params.push(filter.toSessionId);
    }
    if (filter?.worktreeRoot !== undefined) {
      clauses.push("worktree_root = ?");
      params.push(filter.worktreeRoot);
    }
    if (filter?.undelivered === true) {
      clauses.push("delivered_at is null");
    }
    // `inbox` is an ops-level concept (self-addressed history): ops resolves the
    // current Session and passes it as `toSessionId`. The store has no notion of
    // a "current Session", so it intentionally does not act on `inbox` here.

    const rows = this.db
      .query(
        `select * from messages
         where ${clauses.join(" and ")}
         order by created_at asc, id asc`,
      )
      .all(...params) as MessageRow[];
    return rows.map(parseMessageRow);
  }

  async listMessagePage(
    scope: EffectiveScope,
    query: MessagePageQuery,
  ): Promise<MessagePage> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const budget = query.bodyBudgetBytes ?? 262_144;
    const clauses = ["workspace_id = ?", "sequence > ?"];
    const params: SQLQueryBindings[] = [
      scope.workspaceId,
      query.afterSequence ?? 0,
    ];
    const filter = query.filter;
    if (filter?.toSessionId !== undefined) {
      clauses.push("to_session_id = ?");
      params.push(filter.toSessionId);
    }
    if (filter?.worktreeRoot !== undefined) {
      clauses.push("worktree_root = ?");
      params.push(filter.worktreeRoot);
    }
    if (filter?.undelivered === true) clauses.push("delivered_at is null");
    const candidates = this.db
      .query(
        `select * from messages where ${clauses.join(" and ")} order by sequence asc limit ?`,
      )
      .all(...params, limit + 1) as MessageRow[];
    const rows = [] as MessagePage["rows"];
    let bytes = 0;
    for (const row of candidates.slice(0, limit)) {
      const stored = parseStoredMessageRow(row);
      const size = Buffer.byteLength(stored.message.body, "utf8");
      if (rows.length > 0 && bytes + size > budget) break;
      rows.push(stored);
      bytes += size;
    }
    return { rows, hasMore: rows.length < candidates.length };
  }

  async listMessagesByWorkspace(
    workspaceId: string,
    filter?: MessageListFilter,
  ): Promise<Message[]> {
    const clauses = ["workspace_id = ?"];
    const params: SQLQueryBindings[] = [workspaceId];

    if (filter?.toSessionId !== undefined) {
      clauses.push("to_session_id = ?");
      params.push(filter.toSessionId);
    }
    if (filter?.worktreeRoot !== undefined) {
      clauses.push("worktree_root = ?");
      params.push(filter.worktreeRoot);
    }
    if (filter?.undelivered === true) {
      clauses.push("delivered_at is null");
    }

    const rows = this.db
      .query(
        `select * from messages
         where ${clauses.join(" and ")}
         order by created_at asc, id asc`,
      )
      .all(...params) as MessageRow[];
    return rows.map(parseMessageRow);
  }

  async markMessageDelivered(
    scope: EffectiveScope,
    id: string,
    deliveredAt: string,
  ): Promise<void> {
    this.db
      .query(
        `update messages set delivered_at = ?, delivery_error = null
         where workspace_id = ? and id = ?`,
      )
      .run(deliveredAt, scope.workspaceId, id);
  }

  async markMessageDeliveryError(
    scope: EffectiveScope,
    id: string,
    deliveryError: string,
  ): Promise<void> {
    this.db
      .query(
        `update messages set delivery_error = ?, delivered_at = null
         where workspace_id = ? and id = ?`,
      )
      .run(deliveryError, scope.workspaceId, id);
  }

  // --- Transactions -------------------------------------------------------

  /**
   * Run `fn` inside a single transaction. On success the work is committed; if
   * `fn` rejects or throws, the transaction is rolled back and the error is
   * re-thrown. The transactional handle is this same store (one connection), so
   * the scoped primitives `fn` calls participate in the surrounding
   * transaction. Nesting is rejected: callers compose multiple primitives in
   * one `withTransaction` rather than nesting transactions.
   */
  async withTransaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new Error("SqliteStore.withTransaction does not support nesting");
    }
    this.inTransaction = true;
    this.db.run("BEGIN");
    try {
      const result = await fn(this);
      this.db.run("COMMIT");
      return result;
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /** Close the underlying connection. Not part of the {@link Store} port. */
  close(): void {
    this.db.close();
  }
}

/** Options for {@link openSqliteStore}. */
export interface OpenSqliteStoreOptions {
  /** SQLite file path. Use `":memory:"` (the default) for ephemeral stores. */
  path?: string;
}

/**
 * Open (or create) a SQLite database and return a migrated {@link SqliteStore}.
 * The durable asem database lives at `~/.asem/state.db` (ADR 0001); callers pass
 * that path. Tests pass `":memory:"` or a temp-file path.
 */
export function openSqliteStore(
  options: OpenSqliteStoreOptions = {},
): SqliteStore {
  const db = new Database(options.path ?? ":memory:");
  return new SqliteStore(db);
}
