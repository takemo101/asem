import { expect } from "bun:test";
import type {
  EffectiveScope,
  Message,
  OperationError,
  OperationResult,
  Session,
} from "@asem/core";

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

/**
 * Two scopes sharing one workspace id but different worktree roots — the
 * isolation boundary under test (ADR 0002). `cwd` equal to the worktree root so
 * the default FakeScopeResolver reproduces them from a bare cwd.
 */
export const scopeA: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/a",
};

export const scopeB: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/b",
};

let seq = 0;
function suffix(): string {
  seq += 1;
  return String(seq).padStart(4, "0");
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  const s = suffix();
  return {
    id: `s_${s}`,
    workspaceId: scopeA.workspaceId,
    worktreeRoot: scopeA.worktreeRoot,
    name: `session-${s}`,
    cwd: scopeA.worktreeRoot,
    agent: "claude",
    mux: "herdr",
    model: null,
    parentSessionId: null,
    status: "running",
    muxRef: { workspace: "w1", tab: "t1", pane: "p1" },
    sessionDir: `${scopeA.worktreeRoot}/.asem/sessions/s_${s}`,
    tokenHash: "sha256:deadbeef",
    createdAt: "2026-06-05T12:00:00.000Z",
    updatedAt: "2026-06-05T12:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  const s = suffix();
  return {
    id: `m_${s}`,
    workspaceId: scopeA.workspaceId,
    worktreeRoot: scopeA.worktreeRoot,
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
