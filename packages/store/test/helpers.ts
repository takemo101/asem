import { Database } from "bun:sqlite";
import type { EffectiveScope, Message, Session } from "@asem/core";
import { SqliteStore } from "../src/index.ts";

/** A fresh in-memory store plus its raw connection (for corruption seeding). */
export function freshStore(): { store: SqliteStore; db: Database } {
  const db = new Database(":memory:");
  const store = new SqliteStore(db);
  return { store, db };
}

export const scopeA: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/.worktrees/a",
};

/** Same workspace, different worktree — the isolation boundary under test. */
export const scopeB: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/.worktrees/b",
};

let seq = 0;
function nextSuffix(): string {
  seq += 1;
  return String(seq).padStart(4, "0");
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  const suffix = nextSuffix();
  return {
    id: `s_${suffix}`,
    workspaceId: scopeA.workspaceId,
    worktreeRoot: scopeA.worktreeRoot,
    name: `session-${suffix}`,
    cwd: scopeA.worktreeRoot,
    agent: "claude",
    mux: "herdr",
    model: null,
    profile: null,
    profileSource: null,
    parentSessionId: null,
    status: "running",
    muxRef: { workspace: "w1", tab: "t1", pane: "p1" },
    sessionDir: `${scopeA.worktreeRoot}/.asem/sessions/s_${suffix}`,
    tokenHash: "sha256:deadbeef",
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-05T12:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  const suffix = nextSuffix();
  return {
    id: `m_${suffix}`,
    workspaceId: scopeA.workspaceId,
    worktreeRoot: scopeA.worktreeRoot,
    fromSessionId: null,
    toSessionId: "s_target",
    kind: "message",
    body: "hello",
    formattedBody: "[asem message] hello",
    deliveredAt: null,
    deliveryError: null,
    createdAt: "2026-06-05T12:00:00Z",
    ...overrides,
  };
}
