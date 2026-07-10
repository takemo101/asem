import { describe, expect, test } from "bun:test";
import {
  isStoreError,
  type MessageRow,
  parseMessageRow,
  parseSessionRow,
  type SessionRow,
} from "../src/index.ts";
import { parseStoredMessageRow } from "../src/rows.ts";
import { freshStore, makeMessage, makeSession, scopeA } from "./helpers.ts";

/**
 * The store parses rows into typed `@asem/core` values, so a corrupt row must
 * fail loudly rather than leak an untyped row to callers. These tests seed bad
 * rows directly through the raw connection to simulate DB corruption.
 */

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
  model: string | null;
  profile: string | null;
  profile_source: string | null;
}

function rawSessionRow(overrides: Partial<RawSessionFields>): SessionRow {
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
    model: null,
    profile: null,
    profile_source: null,
    ...overrides,
  };
  return base;
}

/** A valid raw `sessions` row object (pre-parse), for field-level parse tests. */
function rawSessionRowObject(): SessionRow {
  return {
    id: "s_ok",
    workspace_id: scopeA.workspaceId,
    worktree_root: scopeA.worktreeRoot,
    name: "ok",
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
    model: null,
    profile: null,
    profile_source: null,
  };
}

describe("row parse failures — sessions", () => {
  test("invalid status value fails as row_parse_failed", () => {
    let caught: unknown;
    try {
      parseSessionRow(rawSessionRow({ status: "completed" }));
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "row_parse_failed")).toBe(true);
  });

  test("non-JSON mux_ref_json fails as row_parse_failed", () => {
    let caught: unknown;
    try {
      parseSessionRow(rawSessionRow({ mux_ref_json: "not json" }));
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "row_parse_failed")).toBe(true);
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
  test("invalid kind value fails as row_parse_failed", () => {
    let caught: unknown;
    try {
      parseMessageRow({
        id: "m_bad",
        workspace_id: scopeA.workspaceId,
        worktree_root: scopeA.worktreeRoot,
        from_session_id: null,
        to_session_id: "s_x",
        kind: "broadcast", // not a valid MessageKind
        body: "body",
        formatted_body: "formatted",
        delivered_at: null,
        delivery_error: null,
        created_at: "2026-06-05T12:00:00Z",
      });
    } catch (error) {
      caught = error;
    }
    expect(isStoreError(caught, "row_parse_failed")).toBe(true);
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

  test("parseStoredMessageRow rejects a missing or invalid sequence", () => {
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
      created_at: "2026-06-05T12:00:00Z",
    } satisfies MessageRow;

    for (const sequence of [undefined, 0]) {
      let caught: unknown;
      try {
        parseStoredMessageRow({ ...row, sequence });
      } catch (error) {
        caught = error;
      }
      expect(isStoreError(caught, "row_parse_failed")).toBe(true);
    }
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

describe("Session model column", () => {
  test("parseSessionRow maps a non-null model", () => {
    const session = parseSessionRow({
      ...rawSessionRowObject(),
      model: "sonnet",
    });
    expect(session.model).toBe("sonnet");
  });

  test("parseSessionRow maps a missing/null model to null", () => {
    expect(parseSessionRow(rawSessionRowObject()).model).toBeNull();
    expect(
      parseSessionRow({ ...rawSessionRowObject(), model: null }).model,
    ).toBeNull();
  });

  test("a model is persisted and read back", async () => {
    const { store } = freshStore();
    const session = makeSession({ id: "s_model", model: "sonnet" });
    await store.insertSession(session);
    expect((await store.getSessionById(scopeA, "s_model"))?.model).toBe(
      "sonnet",
    );

    const noModel = makeSession({ id: "s_none", model: null });
    await store.insertSession(noModel);
    expect((await store.getSessionById(scopeA, "s_none"))?.model).toBeNull();
  });
});
