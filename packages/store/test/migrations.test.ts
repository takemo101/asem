import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LATEST_SCHEMA_VERSION, migrate, SqliteStore } from "../src/index.ts";
import { freshStore } from "./helpers.ts";

interface NameRow {
  name: string;
}

function tableNames(db: Database): string[] {
  return (
    db
      .query("select name from sqlite_master where type = 'table'")
      .all() as NameRow[]
  ).map((r) => r.name);
}

function indexNames(db: Database): string[] {
  return (
    db
      .query("select name from sqlite_master where type = 'index'")
      .all() as NameRow[]
  ).map((r) => r.name);
}

describe("migrations — initialization", () => {
  test("creates the documented sessions and messages tables", () => {
    const { db } = freshStore();
    const tables = tableNames(db);
    expect(tables).toContain("sessions");
    expect(tables).toContain("messages");
  });

  test("creates the required indexes and unique constraint", () => {
    const { db } = freshStore();
    const indexes = indexNames(db);
    expect(indexes).toContain("sessions_workspace_name_unique");
    expect(indexes).toContain("idx_sessions_workspace_worktree_created");
    expect(indexes).toContain("idx_sessions_workspace_status");
    expect(indexes).toContain("idx_messages_workspace_created");
    expect(indexes).toContain("idx_messages_to_created");
    expect(indexes).toContain("idx_messages_delivery_error");
    expect(indexes).toContain("idx_messages_workspace_sequence");
    expect(indexes).toContain("idx_messages_to_sequence");
  });

  test("the Workspace-name index is unique", () => {
    const { db } = freshStore();
    const info = db
      .query(
        "select sql from sqlite_master where name = 'sessions_workspace_name_unique'",
      )
      .get() as { sql: string };
    expect(info.sql.toLowerCase()).toContain("unique index");
    expect(info.sql).toContain("workspace_id");
    expect(info.sql).not.toContain("worktree_root");
    expect(info.sql).toContain("name");
  });

  test("records the latest schema version", () => {
    const { db } = freshStore();
    const row = db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(row.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(5);
  });

  test("adds the nullable sessions.model column (schema version 2)", () => {
    const { db } = freshStore();
    const columns = (
      db.query("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toContain("model");
  });

  test("adds the nullable profile/profile_source columns (schema version 3)", () => {
    const { db } = freshStore();
    const columns = (
      db.query("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toContain("profile");
    expect(columns).toContain("profile_source");
  });
});

describe("migrations — forward from a version-1 database", () => {
  /** The version-1 `sessions` DDL, deliberately without the `model` column. */
  const V1_SESSIONS = `
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
  `;

  test("migrating a v1 DB adds model and existing rows read as null", async () => {
    const db = new Database(":memory:");
    // Seed a version-1 schema with a pre-existing row, before `model` existed.
    db.run(V1_SESSIONS);
    db.run("PRAGMA user_version = 1");
    db.query(
      `insert into sessions (
         id, workspace_id, worktree_root, name, cwd, agent, mux,
         parent_session_id, status, mux_ref_json, session_dir, token_hash,
         created_at, updated_at, closed_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "s_legacy",
      "ws_1",
      "/repo/a",
      "legacy",
      "/repo/a",
      "claude",
      "herdr",
      null,
      "running",
      "{}",
      "/repo/a/.asem/sessions/s_legacy",
      "sha256:x",
      "2026-06-05T12:00:00Z",
      "2026-06-05T12:00:00Z",
      null,
    );

    // The store runs `migrate` on construction, advancing v1 → latest.
    const store = new SqliteStore(db);
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(LATEST_SCHEMA_VERSION);

    const session = await store.getSessionById(
      { workspaceId: "ws_1", worktreeRoot: "/repo/a" },
      "s_legacy",
    );
    expect(session).not.toBeNull();
    expect(session?.model).toBeNull();
    // MIK-041: the profile columns also migrate forward as null for old rows.
    expect(session?.profile).toBeNull();
    expect(session?.profileSource).toBeNull();
  });
});

describe("migrations — forward from a version-4 database", () => {
  test("rebuilds Messages in deterministic order without losing legacy data", async () => {
    const db = new Database(":memory:");
    db.run(`
      create table messages (
        id text primary key, workspace_id text not null, worktree_root text not null,
        from_session_id text, to_session_id text not null, kind text not null,
        body text not null, formatted_body text not null, delivered_at text,
        delivery_error text, created_at text not null
      );
      insert into messages values
        ('m_b', 'ws_1', '/repo/a', null, 's_to', 'message', 'body-b', 'formatted-b', null, 'error-b', '2026-06-05T12:00:01Z'),
        ('m_a', 'ws_1', '/repo/a', 's_from', 's_to', 'report', 'body-a', 'formatted-a', '2026-06-05T12:01:00Z', null, '2026-06-05T12:00:00Z'),
        ('m_c', 'ws_1', '/repo/a', null, 's_to', 'message', 'body-c', 'formatted-c', null, null, '2026-06-05T12:00:00Z');
      PRAGMA user_version = 4;
    `);

    const store = new SqliteStore(db);
    const rows = db
      .query(`
      select sequence, id, from_session_id, kind, body, formatted_body,
        delivered_at, delivery_error, created_at
      from messages order by sequence
    `)
      .all() as Array<{
      sequence: number;
      id: string;
      from_session_id: string | null;
      kind: string;
      body: string;
      formatted_body: string;
      delivered_at: string | null;
      delivery_error: string | null;
      created_at: string;
    }>;
    expect(rows).toEqual([
      {
        sequence: 1,
        id: "m_a",
        from_session_id: "s_from",
        kind: "report",
        body: "body-a",
        formatted_body: "formatted-a",
        delivered_at: "2026-06-05T12:01:00Z",
        delivery_error: null,
        created_at: "2026-06-05T12:00:00Z",
      },
      {
        sequence: 2,
        id: "m_c",
        from_session_id: null,
        kind: "message",
        body: "body-c",
        formatted_body: "formatted-c",
        delivered_at: null,
        delivery_error: null,
        created_at: "2026-06-05T12:00:00Z",
      },
      {
        sequence: 3,
        id: "m_b",
        from_session_id: null,
        kind: "message",
        body: "body-b",
        formatted_body: "formatted-b",
        delivered_at: null,
        delivery_error: "error-b",
        created_at: "2026-06-05T12:00:01Z",
      },
    ]);

    await store.insertMessage({
      id: "m_new",
      workspaceId: "ws_1",
      worktreeRoot: "/repo/a",
      fromSessionId: null,
      toSessionId: "s_to",
      kind: "message",
      body: "new",
      formattedBody: "new",
      deliveredAt: null,
      deliveryError: null,
      createdAt: "2026-06-05T12:00:02Z",
    });
    expect(
      (
        db.query("select sequence from messages where id = 'm_new'").get() as {
          sequence: number;
        }
      ).sequence,
    ).toBe(4);
  });
});

describe("migrations — idempotency", () => {
  test("re-running migrate on the same DB is a no-op", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(tableNames(db)).toContain("sessions");
  });

  test("constructing a second store over an open connection is safe", () => {
    const db = new Database(":memory:");
    // eslint-disable-next-line no-new
    new SqliteStore(db);
    expect(() => new SqliteStore(db)).not.toThrow();
  });
});
