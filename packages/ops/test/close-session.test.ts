import { describe, expect, test } from "bun:test";
import { type ConfigDiscovery, hashToken } from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { closeSession } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const CURRENT_TOKEN = "tok-current";
const HERDR_REF = {
  pane_id: "pane-1",
  tab_id: "tab-1",
  herdr_workspace_id: "herdr-workspace-1",
  herdr_session: "asem",
};

/** Deps scoped to {@link scopeA}, keeping typed references to the fakes. */
function deps(
  overrides: {
    runner?: FakeTemplateRunner;
    store?: FakeStore;
    currentSessionResolver?: FakeCurrentSessionResolver;
  } = {},
) {
  const store = overrides.store ?? new FakeStore();
  const runner = overrides.runner ?? new FakeTemplateRunner();
  const logger = new MemoryLogger();
  const bundle = makeOpsDeps({
    store,
    templateRunner: runner,
    logger,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...(overrides.currentSessionResolver
      ? { currentSessionResolver: overrides.currentSessionResolver }
      : {}),
  });
  return { ...bundle, store, runner, logger };
}

/** A herdr Session whose `close` sequence closes its owning workspace. */
function makeRunning(overrides = {}) {
  return makeSession({
    name: "reviewer-1",
    status: "running",
    mux: "herdr",
    muxRef: HERDR_REF,
    ...overrides,
  });
}

describe("closeSession — pane control + status update", () => {
  test("closes a running Session: runs mux close, sets closed + closed_at", async () => {
    const store = new FakeStore();
    const session = makeRunning();
    store.sessions.push(session);
    const d = deps({ store });

    const { session: closed } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );

    // The herdr `close` sequence closes the owning workspace.
    expect(d.runner.commands).toHaveLength(1);
    expect(d.runner.commands[0]!.command).toContain(
      "herdr --session 'asem' workspace close 'herdr-workspace-1'",
    );
    expect(d.runner.commands[0]!.cwd).toBe(session.cwd);

    // Status moves to closed with a closed_at stamp; never a work outcome.
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.updatedAt).toBe(closed.closedAt ?? "");

    // Persisted consistently.
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("closed");
    expect(stored?.closedAt).toBe(closed.closedAt);
  });

  test("closes a borrowed current-pane Session without running mux close", async () => {
    const store = new FakeStore();
    const session = makeRunning({
      name: "registered-parent",
      muxRef: { ...HERDR_REF, asem_mux_owned: "false" },
    });
    store.sessions.push(session);
    const d = deps({ store });

    const { session: closed } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );

    expect(d.runner.commands).toHaveLength(0);
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("closed");
    expect(stored?.closedAt).toBe(closed.closedAt);
  });
});

describe("closeSession — scoped lookup", () => {
  test("a Session in a sibling worktree is not found (cross-worktree rejection)", async () => {
    const store = new FakeStore();
    // Lives only in scopeB; we operate in scopeA.
    store.sessions.push(
      makeRunning({
        id: "s_b",
        workspaceId: scopeB.workspaceId,
        worktreeRoot: scopeB.worktreeRoot,
      }),
    );
    const d = deps({ store });

    const result = await closeSession(d, { id: "s_b" }, CTX);
    expectErr(result, "session_not_found");
    // No pane control attempted across the boundary.
    expect(d.runner.commands).toHaveLength(0);
  });

  test("a missing Session id is not found", async () => {
    const d = deps();
    expectErr(await closeSession(d, { id: "ghost" }, CTX), "session_not_found");
  });
});

describe("closeSession — truthful handling of non-live Sessions", () => {
  test("an already closed Session is an idempotent no-op", async () => {
    const store = new FakeStore();
    const closedAt = "2026-06-01T00:00:00.000Z";
    const session = makeRunning({ status: "closed", closedAt });
    store.sessions.push(session);
    const d = deps({ store });

    const { session: result } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );

    // No mux command, and the original closed_at is not re-stamped.
    expect(d.runner.commands).toHaveLength(0);
    expect(result.status).toBe("closed");
    expect(result.closedAt).toBe(closedAt);
  });

  test("an exited Session is marked closed without running mux close", async () => {
    const store = new FakeStore();
    const session = makeRunning({ status: "exited" });
    store.sessions.push(session);
    const d = deps({ store });

    const { session: result } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );

    // No live pane to control, but the explicit close is recorded truthfully.
    expect(d.runner.commands).toHaveLength(0);
    expect(result.status).toBe("closed");
    expect(result.closedAt).not.toBeNull();
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("closed");
  });

  test("a missing Session is marked closed without running mux close", async () => {
    const store = new FakeStore();
    const session = makeRunning({ status: "missing" });
    store.sessions.push(session);
    const d = deps({ store });

    const { session: result } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );
    expect(d.runner.commands).toHaveLength(0);
    expect(result.status).toBe("closed");
  });
});

describe("closeSession — mux close failure", () => {
  test("a failed mux close returns the error and leaves status unchanged", async () => {
    const store = new FakeStore();
    const session = makeRunning();
    store.sessions.push(session);
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "pane gone" }],
    });
    const d = deps({ store, runner });

    const result = await closeSession(d, { id: session.id }, CTX);

    // Truthful: the pane may still be alive, so we do not claim a false close.
    expectErr(result, "sequence_step_failed");
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("running");
    expect(stored?.closedAt).toBeNull();
  });

  test("an unknown mux template for a live Session is mux_template_not_found", async () => {
    const store = new FakeStore();
    const session = makeRunning({ mux: "does-not-exist" });
    store.sessions.push(session);
    const d = deps({ store });

    expectErr(
      await closeSession(d, { id: session.id }, CTX),
      "mux_template_not_found",
    );
  });

  test("a malformed project-local mux template returns invalid_template, not a thrown defect", async () => {
    const store = new FakeStore();
    const session = makeRunning();
    store.sessions.push(session);
    const config = makeConfig({
      mux: {
        default: "herdr",
        templates: { herdr: { close: [{ type: "unknown_step" }] } },
      },
    });
    const d = {
      ...deps({ store }),
      configLoader: new FakeConfigLoader({
        kind: "found",
        config,
        configPath: "/repo/.asem.yaml",
      } satisfies ConfigDiscovery),
    };

    const error = expectErr(
      await closeSession(d, { id: session.id }, CTX),
      "invalid_template",
    );
    expect(error.details?.kind).toBe("mux");
    expect(error.details?.name).toBe("herdr");
    // Truthful: the config defect blocks the close, so status stays unchanged.
    expect(d.runner.commands).toHaveLength(0);
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("running");
    expect(stored?.closedAt).toBeNull();
  });
});

describe("closeSession — auth", () => {
  test("an invalid current-Session token is rejected before any pane control", async () => {
    const store = new FakeStore();
    const session = makeRunning();
    const me = makeSession({
      id: "cur_1",
      name: "helper-1",
      tokenHash: hashToken(CURRENT_TOKEN),
    });
    store.sessions.push(session, me);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: "wrong-token",
      }),
    });

    expectErr(
      await closeSession(d, { id: session.id }, CTX),
      "invalid_session_token",
    );
    expect(d.runner.commands).toHaveLength(0);
    const stored = await d.store.getSessionById(scopeA, session.id);
    expect(stored?.status).toBe("running");
  });

  test("a verified current Session may close a target", async () => {
    const store = new FakeStore();
    const session = makeRunning();
    const me = makeSession({
      id: "cur_1",
      name: "helper-1",
      tokenHash: hashToken(CURRENT_TOKEN),
    });
    store.sessions.push(session, me);
    const d = deps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const { session: closed } = expectOk(
      await closeSession(d, { id: session.id }, CTX),
    );
    expect(closed.status).toBe("closed");
  });
});
