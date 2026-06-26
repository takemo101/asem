import { describe, expect, test } from "bun:test";
import {
  type ConfigDiscovery,
  type CurrentSessionRef,
  hashToken,
} from "@asem/core";
import {
  authenticateCurrentSession,
  resolveContext,
  resolveMutationActor,
  sameScope,
} from "../src/context.ts";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

describe("resolveContext", () => {
  test("resolves config + effective scope for a discovered config", async () => {
    const ctx = expectOk(
      await resolveContext(
        {
          configLoader: new FakeConfigLoader(),
          scopeResolver: new FakeScopeResolver(scopeA),
        },
        scopeA.worktreeRoot,
      ),
    );
    expect(ctx.scope).toEqual(scopeA);
    expect(ctx.config.workspace.id).toBe("ws_1");
  });

  test("returns config_not_found when discovery finds nothing", async () => {
    const result = await resolveContext(
      {
        configLoader: new FakeConfigLoader({ kind: "not_found" }),
        scopeResolver: new FakeScopeResolver(scopeA),
      },
      "/repo/a",
    );
    expectErr(result, "config_not_found");
  });

  test("returns invalid_config with the parse issues in details", async () => {
    const discovery: ConfigDiscovery = {
      kind: "invalid",
      configPath: "/repo/a/.asem.yaml",
      issues: ["workspace.id: required"],
    };
    const result = await resolveContext(
      {
        configLoader: new FakeConfigLoader(discovery),
        scopeResolver: new FakeScopeResolver(scopeA),
      },
      "/repo/a",
    );
    const error = expectErr(result, "invalid_config");
    expect(error.details?.issues).toEqual(["workspace.id: required"]);
  });
});

describe("sameScope", () => {
  test("true when the Workspace id matches, regardless of worktree root", () => {
    expect(sameScope(scopeA, { ...scopeA })).toBe(true);
    expect(sameScope(scopeA, scopeB)).toBe(true);
    expect(
      sameScope(scopeA, {
        workspaceId: "ws_other",
        worktreeRoot: scopeA.worktreeRoot,
      }),
    ).toBe(false);
  });
});

describe("authenticateCurrentSession", () => {
  const RAW = "tok-raw";

  function deps(store: FakeStore, ref: CurrentSessionRef | null) {
    return {
      store,
      currentSessionResolver: new FakeCurrentSessionResolver(ref),
    };
  }

  test("returns the verified current Session", async () => {
    const store = new FakeStore();
    const me = makeSession({ name: "me", tokenHash: hashToken(RAW) });
    store.sessions.push(me);

    const session = expectOk(
      await authenticateCurrentSession(
        deps(store, { sessionId: me.id, token: RAW }),
        scopeA,
      ),
    );
    expect(session.id).toBe(me.id);
  });

  test("current_session_not_found when the resolver yields nothing", async () => {
    expectErr(
      await authenticateCurrentSession(deps(new FakeStore(), null), scopeA),
      "current_session_not_found",
    );
  });

  test("scope_mismatch when the pointer Workspace differs from the resolved Workspace", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(RAW) });
    store.sessions.push(me);
    expectErr(
      await authenticateCurrentSession(
        deps(store, {
          sessionId: me.id,
          token: RAW,
          scope: { ...scopeB, workspaceId: "ws_other" },
        }),
        scopeA,
      ),
      "scope_mismatch",
    );
  });

  test("session_not_found when the referenced row is absent in scope", async () => {
    expectErr(
      await authenticateCurrentSession(
        deps(new FakeStore(), { sessionId: "ghost", token: RAW }),
        scopeA,
      ),
      "session_not_found",
    );
  });

  test("invalid_session_token when the raw token fails verification", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(RAW) });
    store.sessions.push(me);
    const error = expectErr(
      await authenticateCurrentSession(
        deps(store, { sessionId: me.id, token: "wrong" }),
        scopeA,
      ),
      "invalid_session_token",
    );
    // The error payload must never carry token material (principle 8).
    expect(JSON.stringify(error)).not.toContain("wrong");
  });
});

describe("resolveMutationActor", () => {
  const CURRENT_TOKEN = "tok-current";

  function actorDeps(
    overrides: {
      store?: FakeStore;
      currentSessionResolver?: FakeCurrentSessionResolver;
    } = {},
  ) {
    const store = overrides.store ?? new FakeStore();
    return {
      store,
      currentSessionResolver:
        overrides.currentSessionResolver ??
        new FakeCurrentSessionResolver(null),
    };
  }

  test("operator origin skips current-session resolution", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const actor = expectOk(
      await resolveMutationActor(deps, scopeA, {
        cwd: scopeA.worktreeRoot,
        origin: "operator",
      }),
    );

    expect(actor).toEqual({ kind: "operator", session: null, token: null });
  });

  test("agent origin requires and returns the verified current Session", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const actor = expectOk(
      await resolveMutationActor(deps, scopeA, {
        cwd: scopeA.worktreeRoot,
        origin: "agent",
      }),
    );

    expect(actor.kind).toBe("agent");
    expect(actor.session?.id).toBe(me.id);
    expect(actor.token).toBe(CURRENT_TOKEN);
  });

  test("agent origin requires a current Session", async () => {
    expectErr(
      await resolveMutationActor(actorDeps(), scopeA, {
        cwd: scopeA.worktreeRoot,
        origin: "agent",
      }),
      "current_session_not_found",
    );
  });

  test("unset origin with no pointer is anonymous human local trust", async () => {
    const actor = expectOk(
      await resolveMutationActor(actorDeps(), scopeA, {
        cwd: scopeA.worktreeRoot,
      }),
    );

    expect(actor).toEqual({ kind: "human-anon", session: null, token: null });
  });

  test("unset origin with pointer verifies and returns the current Session", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const actor = expectOk(
      await resolveMutationActor(deps, scopeA, { cwd: scopeA.worktreeRoot }),
    );

    expect(actor.kind).toBe("human-current");
    expect(actor.session?.id).toBe(me.id);
    expect(actor.token).toBe(CURRENT_TOKEN);
  });

  test("token and scope errors are preserved", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);

    expectErr(
      await resolveMutationActor(
        actorDeps({
          store,
          currentSessionResolver: new FakeCurrentSessionResolver({
            sessionId: me.id,
            token: "wrong",
          }),
        }),
        scopeA,
        { cwd: scopeA.worktreeRoot },
      ),
      "invalid_session_token",
    );

    expectErr(
      await resolveMutationActor(
        actorDeps({
          store,
          currentSessionResolver: new FakeCurrentSessionResolver({
            sessionId: me.id,
            token: CURRENT_TOKEN,
            scope: { ...scopeB, workspaceId: "ws_other" },
          }),
        }),
        scopeA,
        { cwd: scopeA.worktreeRoot },
      ),
      "scope_mismatch",
    );
  });
});
