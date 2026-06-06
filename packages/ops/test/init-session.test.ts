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
    expect(session.muxRef).toEqual(MUX_REF);

    // The Session is persisted in scope.
    const store = d.store as FakeStore;
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]!.id).toBe(session.id);

    // The raw token is returned, but only the hash is persisted (principle 8).
    expect(token.length).toBeGreaterThan(0);
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toBe(hashToken(token));
    expect(verifyToken(token, session.tokenHash)).toBe(true);
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
