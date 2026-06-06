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
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(0);
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
