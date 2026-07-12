/**
 * MIK-067: `openSqliteStore` must configure WAL plus a bounded busy timeout so
 * a polling reader connection (Message protocol slice 3 `wait_messages`) and a
 * sibling-process writer never surface transient SQLITE_BUSY under normal
 * local use. Two genuinely separate connections on one temp file stand in for
 * the two processes; bun:sqlite executes statements synchronously, so the
 * interleaving below is deterministic.
 */

import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStore, type SqliteStore } from "../src/index.ts";
import { makeMessage, scopeA } from "./helpers.ts";

/** TS `private` is compile-time only; reach the raw connection to read pragmas. */
function rawDb(store: SqliteStore): Database {
  return (store as unknown as { db: Database }).db;
}

let tempDir: string | null = null;
const openStores: SqliteStore[] = [];

function tempDbPath(): string {
  tempDir = mkdtempSync(join(tmpdir(), "asem-store-concurrency-"));
  return join(tempDir, "state.db");
}

function open(path: string): SqliteStore {
  const store = openSqliteStore({ path });
  openStores.push(store);
  return store;
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  if (tempDir !== null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("openSqliteStore concurrency configuration (MIK-067)", () => {
  test("configures WAL journal mode and a bounded busy timeout", () => {
    const store = open(tempDbPath());
    const db = rawDb(store);

    const journal = db.query("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(journal.journal_mode).toBe("wal");

    const busy = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    expect(busy.timeout).toBe(5_000);
  });

  test("a polling reader transaction does not starve a concurrent writer", async () => {
    const path = tempDbPath();
    const reader = open(path);
    const writer = open(path);

    const message = makeMessage({ id: "m_wal", toSessionId: "s_target" });
    const deliveredAt = "2026-06-05T12:00:05Z";

    // The reader holds an open read transaction — the poll loop mid-cycle —
    // while the writer connection inserts and updates. Without WAL the
    // reader's shared lock makes both writes fail with SQLITE_BUSY.
    await reader.withTransaction(async (tx) => {
      const before = await tx.listMessages(scopeA, {
        toSessionId: "s_target",
        undelivered: true,
      });
      expect(before).toEqual([]);

      await writer.insertMessage(message);
      await writer.markMessageDelivered(scopeA, message.id, deliveredAt);
    });

    // The next poll cycle (fresh read) observes the committed write.
    const after = await reader.listMessages(scopeA, {
      toSessionId: "s_target",
    });
    expect(after).toEqual([{ ...message, deliveredAt }]);
  });
});
