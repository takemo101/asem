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
 * name-per-Workspace constraint, and the documented indexes mirror the
 * persistence model in `docs/designs/asem-session-manager-design.md`.
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
  {
    // MIK-040: optional per-Session model selection. Nullable so existing rows
    // migrate forward as `model = null` (no model was selected).
    version: 2,
    up: `alter table sessions add column model text;`,
  },
  {
    // MIK-041: the selected Agent Profile id and its resolved source. Both
    // nullable so existing rows migrate forward as null (no profile selected).
    version: 3,
    up: `
      alter table sessions add column profile text;
      alter table sessions add column profile_source text;
    `,
  },
  {
    // ADR 0008: Workspace-scoped Session tree. Session names are unique within
    // one Workspace; worktree_root remains location metadata for grouping and
    // filters rather than the normal relationship/communication boundary.
    version: 4,
    up: `
      drop index if exists sessions_scope_name_unique;

      create unique index sessions_workspace_name_unique
        on sessions(workspace_id, name);

      create index if not exists idx_sessions_workspace_worktree_created
        on sessions(workspace_id, worktree_root, created_at desc);
    `,
  },
  {
    // MIK-060: an internal monotonic seek position; UUID id remains public.
    version: 5,
    up: `
      -- Some historical test/minimal v1 databases contain only sessions.
      create table if not exists messages (
        id text primary key, workspace_id text not null, worktree_root text not null,
        from_session_id text, to_session_id text not null, kind text not null,
        body text not null, formatted_body text not null, delivered_at text,
        delivery_error text, created_at text not null
      );
      alter table messages rename to messages_v4;
      create table messages (
        sequence integer primary key autoincrement,
        id text unique not null,
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
      insert into messages (
        id, workspace_id, worktree_root, from_session_id, to_session_id,
        kind, body, formatted_body, delivered_at, delivery_error, created_at
      ) select id, workspace_id, worktree_root, from_session_id, to_session_id,
        kind, body, formatted_body, delivered_at, delivery_error, created_at
        from messages_v4 order by created_at asc, id asc;
      drop table messages_v4;
      create index idx_messages_workspace_created
        on messages(workspace_id, worktree_root, created_at desc);
      create index idx_messages_to_created on messages(to_session_id, created_at desc);
      create index idx_messages_delivery_error
        on messages(workspace_id, worktree_root, delivery_error);
      create index idx_messages_workspace_sequence on messages(workspace_id, sequence);
      create index idx_messages_to_sequence on messages(to_session_id, sequence);
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
