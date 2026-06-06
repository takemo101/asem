import { expect } from "bun:test";
import type {
  Message,
  OperationError,
  OperationResult,
  Session,
} from "@asem/core";
import type { CockpitEnv } from "../src/index.ts";

/** Assert an OperationResult is ok and return its value. */
export function expectOk<T>(result: OperationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Assert an OperationResult failed with `code` and return the error. */
export function expectErr<T>(
  result: OperationResult<T>,
  code: OperationError["code"],
): OperationError {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`expected error ${code}, got ok`);
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

export const WORKTREE_A = "/repo/a";
export const WORKTREE_B = "/repo/b";
export const WORKSPACE = "ws_1";

/** A worktree-scoped cockpit env rooted at WORKTREE_A. */
export function makeEnv(overrides: Partial<CockpitEnv> = {}): CockpitEnv {
  return {
    scopeMode: "worktree",
    workspaceId: WORKSPACE,
    worktreeRoot: WORKTREE_A,
    cwd: WORKTREE_A,
    configPath: `${WORKTREE_A}/.asem.yaml`,
    defaultMux: "herdr",
    defaultAgent: "claude",
    ...overrides,
  };
}

let seq = 0;
function suffix(): string {
  seq += 1;
  return String(seq).padStart(4, "0");
}

/** Build a Session with deterministic defaults; override any field per test. */
export function makeSession(overrides: Partial<Session> = {}): Session {
  const s = suffix();
  return {
    id: `s_${s}`,
    workspaceId: WORKSPACE,
    worktreeRoot: WORKTREE_A,
    name: `session-${s}`,
    cwd: WORKTREE_A,
    agent: "claude",
    mux: "herdr",
    parentSessionId: null,
    status: "running",
    muxRef: { pane_id: "pane-1", tab_id: "tab-1" },
    sessionDir: `${WORKTREE_A}/.asem/sessions/s_${s}`,
    tokenHash: "sha256:deadbeef",
    createdAt: "2026-06-05T12:00:00.000Z",
    updatedAt: "2026-06-05T12:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

/** Build a Message with deterministic defaults; override any field per test. */
export function makeMessage(overrides: Partial<Message> = {}): Message {
  const s = suffix();
  return {
    id: `m_${s}`,
    workspaceId: WORKSPACE,
    worktreeRoot: WORKTREE_A,
    fromSessionId: null,
    toSessionId: "s_target",
    kind: "message",
    body: "hello",
    formattedBody: "[asem message] hello",
    deliveredAt: null,
    deliveryError: null,
    createdAt: "2026-06-05T12:00:00.000Z",
    ...overrides,
  };
}
