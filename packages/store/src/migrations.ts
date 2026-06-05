/**
 * SQLite schema migrations for `@asem/store`.
 *
 * The schema is the durable source of truth for Sessions and Messages
 * (see ADR 0001 and the design doc's persistence model). Migrations are
 * versioned through `PRAGMA user_version` and applied idempotently on store
 * open, so a fresh DB and an up-to-date DB both converge to the documented
 * tables, indexes, and constraints.
 */
import type { Database } from "bun:sqlite";

interface Migration {
  readonly version: number;
  readonly up: string;
}

/**
 * Ordered schema migrations. The `sessions`/`messages` DDL, the unique Session
 * name-per-scope constraint, and the documented indexes mirror the persistence
 * model in `docs/designs/asem-session-manager-design.md`.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: `
      create table sessions (
        id text primary key,
        workspace_id text not null,
        worktree_root text not null,
        name text not null,
        cwd text not null,
        agent text not null,
        mux text not null,
        parent_session_id text,
        status text not null,
        mux_ref_json text not null,
        session_dir text not null,
        token_hash text not null,
        created_at text not null,
        updated_at text not null,
        closed_at text
      );

      create unique index sessions_scope_name_unique
        on sessions(workspace_id, worktree_root, name);

      create index idx_sessions_workspace_status
        on sessions(workspace_id, worktree_root, status);

      create table messages (
        id text primary key,
        workspace_id text not null,
        worktree_root text not null,
        from_session_id text,
        to_session_id text not null,
        kind text not null,
        body text not null,
        formatted_body text not null,
        delivered_at text,
        delivery_error text,
        created_at text not null
      );

      create index idx_messages_workspace_created
        on messages(workspace_id, worktree_root, created_at desc);

      create index idx_messages_to_created
        on messages(to_session_id, created_at desc);

      create index idx_messages_delivery_error
        on messages(workspace_id, worktree_root, delivery_error);
    `,
  },
];

/** The latest schema version this build of the store knows how to produce. */
export const LATEST_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

function currentVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as {
    user_version: number;
  } | null;
  return row?.user_version ?? 0;
}

/**
 * Apply all pending migrations to `db`. Idempotent: already-applied versions
 * are skipped. Each migration runs in its own transaction so a partially
 * applied schema is never committed.
 */
export function migrate(db: Database): void {
  let current = currentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) {
      continue;
    }
    db.transaction(() => {
      db.run(migration.up);
      // PRAGMA cannot be parameterized; the value is an internal constant.
      db.run(`PRAGMA user_version = ${migration.version}`);
    })();
    current = migration.version;
  }
}
