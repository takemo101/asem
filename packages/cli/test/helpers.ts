/**
 * Shared fixtures for `@asem/cli` projection tests.
 *
 * Tests run the CLI against the same in-memory `@asem/ops` fakes the operation
 * tests use — "fully faked deps" — so no real SQLite, shell, filesystem, clock,
 * or tokens are touched (testability rules). The CLI is exercised through
 * `runCli` exactly as the binary would call it.
 */
import {
  type EffectiveScope,
  hashToken,
  type Message,
  type Session,
} from "@asem/core";
import type { OpsDeps } from "@asem/ops";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";

/** Fixed scope the CLI tests resolve into (matches the default fake config). */
export const SCOPE: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/a",
};

/** A sibling worktree sharing the workspace id — the isolation boundary. */
export const SCOPE_SIBLING: EffectiveScope = {
  workspaceId: "ws_1",
  worktreeRoot: "/repo/b",
};

export const CWD = SCOPE.worktreeRoot;

let seq = 0;
function suffix(): string {
  seq += 1;
  return String(seq).padStart(4, "0");
}

export function makeSession(overrides: Partial<Session> = {}): Session {
  const s = suffix();
  return {
    id: `s_${s}`,
    workspaceId: SCOPE.workspaceId,
    worktreeRoot: SCOPE.worktreeRoot,
    name: `session-${s}`,
    cwd: SCOPE.worktreeRoot,
    agent: "claude",
    mux: "herdr",
    model: null,
    parentSessionId: null,
    status: "running",
    muxRef: { pane: "p1" },
    sessionDir: `${SCOPE.worktreeRoot}/.asem/sessions/s_${s}`,
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
    workspaceId: SCOPE.workspaceId,
    worktreeRoot: SCOPE.worktreeRoot,
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

export interface CliFixture {
  deps: OpsDeps;
  store: FakeStore;
}

/**
 * Build a CLI deps bundle whose scope resolves to {@link SCOPE} and whose
 * current Session (when seeded) authenticates with {@link CURRENT_TOKEN}.
 */
export const CURRENT_TOKEN = "tok-current";

export function makeCliFixture(
  options: { store?: FakeStore; current?: { sessionId: string } | null } = {},
): CliFixture {
  const store = options.store ?? new FakeStore();
  const current = options.current ?? null;
  const deps = makeOpsDeps({
    store,
    configLoader: new FakeConfigLoader(),
    scopeResolver: new FakeScopeResolver(SCOPE),
    currentSessionResolver: new FakeCurrentSessionResolver(
      current === null
        ? null
        : { sessionId: current.sessionId, token: CURRENT_TOKEN },
    ),
  });
  return { deps, store };
}

/** Seed a current Session whose token verifies against {@link CURRENT_TOKEN}. */
export function seedCurrentSession(store: FakeStore, name = "me"): Session {
  const me = makeSession({ name, tokenHash: hashToken(CURRENT_TOKEN) });
  store.sessions.push(me);
  return me;
}
