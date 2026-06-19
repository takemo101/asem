import { describe, expect, test } from "bun:test";
import { type ConfigDiscovery, hashToken, verifyToken } from "@asem/core";
import { initSession, TOKEN_FILE_MODE } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeFileSystem,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const MUX_REF = { workspace: "w1", tab: "t1", pane: "p1" };
const BORROWED_MUX_REF = { ...MUX_REF, asem_mux_owned: "false" };

/** A complete herdr pane environment as exported into a herdr-hosted process. */
const HERDR_ENV = {
  HERDR_ENV: "1",
  HERDR_SESSION: "asem",
  HERDR_WORKSPACE_ID: "hw-1",
  HERDR_TAB_ID: "tab-1",
  HERDR_PANE_ID: "pane-1",
};

/** Build a deps bundle keeping typed references to the inspectable fakes. */
function deps(overrides = {}) {
  const fs = new FakeFileSystem();
  const logger = new MemoryLogger();
  const bundle = makeOpsDeps({
    fs,
    logger,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...overrides,
  });
  return { ...bundle, fs, logger };
}

describe("initSession", () => {
  test("registers the Session in the resolved scope and returns the raw token once", async () => {
    const d = deps();
    const result = await initSession(
      d,
      { name: "reviewer-1", muxRef: MUX_REF },
      CTX,
    );

    const { session, token } = expectOk(result);
    expect(session.name).toBe("reviewer-1");
    expect(session.workspaceId).toBe(scopeA.workspaceId);
    expect(session.worktreeRoot).toBe(scopeA.worktreeRoot);
    expect(session.status).toBe("running");
    expect(session.muxRef).toEqual(BORROWED_MUX_REF);

    // The Session is persisted in scope.
    const store = d.store as FakeStore;
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]!.id).toBe(session.id);
    expect(store.sessions[0]!.muxRef).toEqual(BORROWED_MUX_REF);

    // The raw token is returned, but only the hash is persisted (principle 8).
    expect(token.length).toBeGreaterThan(0);
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toBe(hashToken(token));
    expect(verifyToken(token, session.tokenHash)).toBe(true);
  });

  test("marks init-session mux refs as borrowed so close never owns the current pane", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX),
    );

    expect(session.muxRef).toMatchObject(MUX_REF);
    expect(session.muxRef.asem_mux_owned).toBe("false");
  });

  test("uses config defaults for agent and mux when not provided", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX),
    );
    expect(session.agent).toBe("claude");
    expect(session.mux).toBe("herdr");
  });

  test("writes the raw token only to a mode-0600 token file under an ignored path", async () => {
    const d = deps();
    const { session, token } = expectOk(
      await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX),
    );

    const tokenPath = `${scopeA.worktreeRoot}/.asem/tokens/${session.id}.token`;
    const tokenFile = d.fs.files.get(tokenPath);
    expect(tokenFile).toBeDefined();
    expect(tokenFile!.contents).toBe(token);
    expect(tokenFile!.mode).toBe(TOKEN_FILE_MODE);
    expect(TOKEN_FILE_MODE).toBe(0o600);
  });

  test("writes a non-secret current-session pointer that excludes the raw token", async () => {
    const d = deps();
    const { session, token } = expectOk(
      await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX),
    );

    const pointerPath = `${scopeA.worktreeRoot}/.asem/current-session.json`;
    const pointer = d.fs.files.get(pointerPath);
    expect(pointer).toBeDefined();
    // The raw token must never appear in the non-secret pointer.
    expect(pointer!.contents).not.toContain(token);

    const parsed = JSON.parse(pointer!.contents);
    expect(parsed.sessionId).toBe(session.id);
    expect(parsed.workspaceId).toBe(scopeA.workspaceId);
    expect(parsed.worktreeRoot).toBe(scopeA.worktreeRoot);
    // It points at the token file rather than embedding the secret.
    expect(parsed.tokenFile).toBe(
      `${scopeA.worktreeRoot}/.asem/tokens/${session.id}.token`,
    );
  });

  test("does not log raw token material", async () => {
    const d = deps();
    const { token } = expectOk(
      await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX),
    );
    expect(d.logger.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(d.logger.entries)).not.toContain(token);
  });

  test("returns config_not_found when no .asem.yaml is discovered", async () => {
    const d = deps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const result = await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX);
    expectErr(result, "config_not_found");
  });

  test("returns invalid_config when discovery reports an unparseable config", async () => {
    const discovery: ConfigDiscovery = {
      kind: "invalid",
      configPath: "/repo/a/.asem.yaml",
      issues: ["bad yaml"],
    };
    const d = deps({ configLoader: new FakeConfigLoader(discovery) });
    const result = await initSession(d, { name: "s1", muxRef: MUX_REF }, CTX);
    expectErr(result, "invalid_config");
  });

  test("rejects a parent that is not in scope with parent_session_not_found", async () => {
    const d = deps();
    const result = await initSession(
      d,
      { name: "s1", muxRef: MUX_REF, parentSessionId: "missing" },
      CTX,
    );
    expectErr(result, "parent_session_not_found");
  });

  test("surfaces a same-scope name collision as session_name_conflict", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "dup" }));
    const d = deps({ store });

    const result = await initSession(d, { name: "dup", muxRef: MUX_REF }, CTX);
    expectErr(result, "session_name_conflict");
  });

  test("rejects invalid input with invalid_input", async () => {
    const d = deps();
    const result = await initSession(
      d,
      { name: "", muxRef: MUX_REF } as never,
      CTX,
    );
    expectErr(result, "invalid_input");
  });
});

describe("initSession — herdr environment auto-registration", () => {
  test("auto-registers mux: herdr from a complete herdr environment when no explicit mux is given", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(
        d,
        { name: "root-1" },
        { cwd: scopeA.worktreeRoot, env: HERDR_ENV },
      ),
    );

    expect(session.mux).toBe("herdr");
    // muxRef carries the discovered herdr pane coordinates and the borrowed
    // marker so close/delete never owns the operator's current pane.
    expect(session.muxRef).toEqual({
      herdr_session: "asem",
      herdr_workspace_id: "hw-1",
      tab_id: "tab-1",
      pane_id: "pane-1",
      asem_mux_owned: "false",
    });
  });

  test("explicit mux wins over a complete herdr environment", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(
        d,
        { name: "root-1", mux: "none", muxRef: {} },
        { cwd: scopeA.worktreeRoot, env: HERDR_ENV },
      ),
    );
    expect(session.mux).toBe("none");
  });

  test("preserves an explicit mux: none as an intentionally non-deliverable Session", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(d, { name: "root-1", mux: "none", muxRef: {} }, CTX),
    );
    expect(session.mux).toBe("none");
    expect(session.muxRef.asem_mux_owned).toBe("false");
  });

  test("explicit muxRef fields override herdr-derived identifiers", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(
        d,
        { name: "root-1", muxRef: { pane_id: "override" } },
        { cwd: scopeA.worktreeRoot, env: HERDR_ENV },
      ),
    );
    expect(session.mux).toBe("herdr");
    expect(session.muxRef.pane_id).toBe("override");
    expect(session.muxRef.herdr_session).toBe("asem");
  });

  test("returns incomplete_mux_env when herdr is indicated but identifiers are incomplete and no explicit mux is given", async () => {
    const d = deps();
    const { HERDR_PANE_ID: _omitted, ...incomplete } = HERDR_ENV;
    const result = await initSession(
      d,
      { name: "root-1" },
      { cwd: scopeA.worktreeRoot, env: incomplete },
    );

    const error = expectErr(result, "incomplete_mux_env");
    expect(error.details?.missing).toContain("HERDR_PANE_ID");
    // The actionable error has no side effect: no Session row is persisted.
    expect((d.store as FakeStore).sessions).toHaveLength(0);
  });

  test("does not auto-register herdr when HERDR_ENV is unset, keeping the provided muxRef and configured default", async () => {
    const d = deps();
    const { session } = expectOk(
      await initSession(d, { name: "root-1", muxRef: MUX_REF }, CTX),
    );
    expect(session.mux).toBe("herdr");
    expect(session.muxRef).toEqual(BORROWED_MUX_REF);
  });
});
