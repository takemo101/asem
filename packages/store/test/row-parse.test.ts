import { describe, expect, test } from "bun:test";
import {
  isStoreError,
  parseMessageRow,
  parseSessionRow,
  type MessageRow,
  type SessionRow,
} from "../src/index.ts";
import type { SQLQueryBindings } from "bun:sqlite";
import { freshStore, makeMessage, makeSession, scopeA } from "./helpers.ts";

/**
 * The store parses rows into typed `@asem/core` values, so a corrupt row must
 * fail loudly rather than leak an untyped row to callers. These tests seed bad
 * rows directly through the raw connection to simulate DB corruption.
 */

const INSERT_RAW_SESSION = `
  insert into sessions (
    id, workspace_id, worktree_root, name, cwd, agent, mux,
    parent_session_id, status, mux_ref_json, session_dir, token_hash,
    created_at, updated_at, closed_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

interface RawSessionFields {
  id: string | null;
  workspace_id: string | null;
  worktree_root: string | null;
  name: string | null;
  cwd: string | null;
  agent: string | null;
  mux: string | null;
  parent_session_id: string | null;
  status: string | null;
  mux_ref_json: string | null;
  session_dir: string | null;
  token_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
}

function rawSessionRow(
  overrides: Partial<RawSessionFields>,
): SQLQueryBindings[] {
  const base: RawSessionFields = {
    id: "s_bad",
    workspace_id: scopeA.workspaceId,
    worktree_root: scopeA.worktreeRoot,
    name: "bad",
    cwd: scopeA.worktreeRoot,
    agent: "claude",
    mux: "herdr",
    parent_session_id: null,
    status: "running",
    mux_ref_json: "{}",
    session_dir: "/dir",
    token_hash: "sha256:x",
    created_at: "2026-06-05T12:00:00Z",
    updated_at: "2026-06-05T12:00:00Z",
    closed_at: null,
    ...overrides,
  };
  return [
    base.id,
    base.workspace_id,
    base.worktree_root,
    base.name,
    base.cwd,
    base.agent,
    base.mux,
    base.parent_session_id,
    base.status,
    base.mux_ref_json,
    base.session_dir,
    base.token_hash,
    base.created_at,
    base.updated_at,
    base.closed_at,
  ];
}

describe("row parse failures — sessions", () => {
  test("invalid status value fails as row_parse_failed", async () => {
    const { store, db } = freshStore();
    db.query(INSERT_RAW_SESSION).run(
      ...rawSessionRow({ status: "completed" }),
    );

    let caught: unknown;
    try {
      await store.getSessionById(scopeA, "s_bad");
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "row_parse_failed")).toBe(true);
  });

  test("non-JSON mux_ref_json fails as row_parse_failed", async () => {
    const { store, db } = freshStore();
    db.query(INSERT_RAW_SESSION).run(
      ...rawSessionRow({ mux_ref_json: "not json" }),
    );
    await expect(store.getSessionById(scopeA, "s_bad")).rejects.toMatchObject({
      code: "row_parse_failed",
    });
  });

  test("listSessions surfaces a corrupt row", async () => {
    const { store, db } = freshStore();
    db.query(INSERT_RAW_SESSION).run(...rawSessionRow({ status: "weird" }));
    await expect(store.listSessions(scopeA)).rejects.toMatchObject({
      code: "row_parse_failed",
    });
  });

  test("parseSessionRow rejects a missing required field", () => {
    const row = { id: "s_x" } as unknown as SessionRow;
    expect(() => parseSessionRow(row)).toThrow();
    try {
      parseSessionRow(row);
    } catch (error) {
      expect(isStoreError(error, "row_parse_failed")).toBe(true);
    }
  });
});

describe("row parse failures — messages", () => {
  test("invalid kind value fails as row_parse_failed", async () => {
    const { store, db } = freshStore();
    db.query(
      `insert into messages (
         id, workspace_id, worktree_root, from_session_id, to_session_id,
         kind, body, formatted_body, delivered_at, delivery_error, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "m_bad",
      scopeA.workspaceId,
      scopeA.worktreeRoot,
      null,
      "s_x",
      "broadcast", // not a valid MessageKind
      "body",
      "formatted",
      null,
      null,
      "2026-06-05T12:00:00Z",
    );
    await expect(store.listMessages(scopeA)).rejects.toMatchObject({
      code: "row_parse_failed",
    });
  });

  test("parseMessageRow rejects a bad timestamp", () => {
    const row = {
      id: "m_x",
      workspace_id: "ws",
      worktree_root: "/wt",
      from_session_id: null,
      to_session_id: "s",
      kind: "message",
      body: "b",
      formatted_body: "f",
      delivered_at: null,
      delivery_error: null,
      created_at: "not-a-timestamp",
    } satisfies MessageRow;
    expect(() => parseMessageRow(row)).toThrow();
  });
});

describe("round-trip parsing", () => {
  test("valid inserted rows parse back to equal domain values", async () => {
    const { store } = freshStore();
    const session = makeSession({ id: "s_ok", muxRef: { a: 1, b: "x" } });
    await store.insertSession(session);
    expect(await store.getSessionById(scopeA, "s_ok")).toEqual(session);

    const message = makeMessage({ id: "m_ok" });
    await store.insertMessage(message);
    expect((await store.listMessages(scopeA))[0]).toEqual(message);
  });
});
