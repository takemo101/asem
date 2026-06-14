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
    expect(indexes).toContain("sessions_scope_name_unique");
    expect(indexes).toContain("idx_sessions_workspace_status");
    expect(indexes).toContain("idx_messages_workspace_created");
    expect(indexes).toContain("idx_messages_to_created");
    expect(indexes).toContain("idx_messages_delivery_error");
  });

  test("the scope-name index is unique", () => {
    const { db } = freshStore();
    const info = db
      .query(
        "select sql from sqlite_master where name = 'sessions_scope_name_unique'",
      )
      .get() as { sql: string };
    expect(info.sql.toLowerCase()).toContain("unique index");
    expect(info.sql).toContain("workspace_id");
    expect(info.sql).toContain("worktree_root");
    expect(info.sql).toContain("name");
  });

  test("records the latest schema version", () => {
    const { db } = freshStore();
    const row = db.query("PRAGMA user_version").get() as {
      user_version: number;
    };
    expect(row.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(2);
  });

  test("adds the nullable sessions.model column (schema version 2)", () => {
    const { db } = freshStore();
    const columns = (
      db.query("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toContain("model");
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
