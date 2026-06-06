import { describe, expect, test } from "bun:test";
import {
  type ConfigDiscovery,
  type CurrentSessionRef,
  hashToken,
} from "@asem/core";
import {
  authenticateCurrentSession,
  resolveContext,
  sameScope,
} from "../src/index.ts";
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
  test("true only when workspace id and worktree root both match", () => {
    expect(sameScope(scopeA, { ...scopeA })).toBe(true);
    expect(sameScope(scopeA, scopeB)).toBe(false);
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

  test("scope_mismatch when the pointer scope differs from the resolved scope", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(RAW) });
    store.sessions.push(me);
    expectErr(
      await authenticateCurrentSession(
        deps(store, { sessionId: me.id, token: RAW, scope: scopeB }),
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
