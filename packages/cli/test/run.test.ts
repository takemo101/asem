import { describe, expect, test } from "bun:test";
import { configPathFor } from "@asem/ops";
import { FakeTemplateRunner } from "@asem/runtime";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  FakeLivenessProbe,
  FakeScopeResolver,
  FakeStore,
  MemoryLogger,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import { BufferIo } from "../src/io.ts";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli } from "../src/run.ts";
import {
  CWD,
  makeCliFixture,
  makeMessage,
  makeSession,
  SCOPE,
  SCOPE_SIBLING,
  seedCurrentSession,
} from "./helpers.ts";

/** Run one command against fake deps and return io + exit code. */
async function run(argv: string[], deps = makeCliFixture().deps) {
  const io = new BufferIo();
  const code = await runCli({ argv, cwd: CWD, deps, io });
  return { io, code };
}

describe("runCli help & usage", () => {
  test("no args prints usage and exits 0", async () => {
    const { io, code } = await run([]);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("usage: asem");
  });

  test("unknown command exits with usage code and structured error", async () => {
    const { io, code } = await run(["frob"]);
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
  });

  test("invalid input (bad mux-ref) exits with usage code", async () => {
    const { code } = await run([
      "init-session",
      "--name",
      "x",
      "--mux-ref",
      "nope",
    ]);
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("runCli init", () => {
  test("creates config and renders the path", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--workspace", "ws-new"],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);
    const configPath = configPathFor(CWD);
    expect(io.outText()).toContain(configPath);
    // The operation — not the CLI — performed the write.
    expect(await deps.fs.exists(configPath)).toBe(true);
  });

  test("non-interactive init materializes selected builtin templates", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--workspace", "ws-new", "--agent", "pi", "--mux", "tmux"],
      cwd: CWD,
      deps,
      io,
    });

    expect(code).toBe(EXIT_OK);
    const config = await deps.fs.readFile(configPathFor(CWD));
    expect(config).toContain("default: tmux");
    expect(config).toContain("default: pi");
    expect(config).toContain("tmux new-window");
    expect(config).toContain("command: pi");
  });

  test("interactive init in non-TTY exits with guidance", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive"],
      cwd: CWD,
      deps,
      io,
      isTty: false,
    });

    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("interactive init requires a TTY");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });

  test("interactive init cancellation exits 0 and writes no config", async () => {
    const { deps } = makeCliFixture();
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--workspace", "ws-new"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => "ws-new",
        select: async <T extends string>() => "pi" as T,
        confirm: async () => false,
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("cancelled; no files changed");
    expect(await deps.fs.exists(configPathFor(CWD))).toBe(false);
  });

  test("interactive init leaves an existing config untouched without prompting", async () => {
    const { deps } = makeCliFixture();
    await deps.fs.writeFileAtomic(
      configPathFor(CWD),
      "workspace:\n  id: existing\n",
    );
    const io = new BufferIo();
    const code = await runCli({
      argv: ["init", "--interactive", "--agent", "does-not-matter"],
      cwd: CWD,
      deps,
      io,
      isTty: true,
      prompts: {
        input: async () => {
          throw new Error("should not prompt");
        },
        select: async () => {
          throw new Error("should not prompt");
        },
        confirm: async () => {
          throw new Error("should not prompt");
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(await deps.fs.readFile(configPathFor(CWD))).toBe(
      "workspace:\n  id: existing\n",
    );
    expect(await deps.fs.exists(`${CWD}/.gitignore`)).toBe(true);
  });
});

describe("runCli init-session", () => {
  test("prints the four shell exports without leaking the token to logs", async () => {
    const logger = new MemoryLogger();
    const deps = makeOpsDeps({
      scopeResolver: new FakeScopeResolver(SCOPE),
      logger,
    });
    const io = new BufferIo();
    const code = await runCli({
      argv: [
        "init-session",
        "--name",
        "reviewer-1",
        "--root",
        "--mux-ref",
        '{"pane":"p1"}',
      ],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);

    const out = io.outText();
    expect(out).toContain("export AS_SESSION_ID=");
    expect(out).toContain("export AS_SESSION_TOKEN=");
    expect(out).toContain("export AS_WORKSPACE_ID=");
    expect(out).toContain("export AS_WORKTREE_ROOT=");

    // FakeTokenGenerator emits tok_0001; it must reach stdout exports only —
    // never the logger or stderr (implementation principle 8).
    const token = "tok_0001";
    expect(out).toContain(token);
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain(token);
    expect(io.errText()).not.toContain(token);
  });

  test("--json prints token + identity fields as JSON", async () => {
    const deps = makeOpsDeps({ scopeResolver: new FakeScopeResolver(SCOPE) });
    const io = new BufferIo();
    const code = await runCli({
      argv: [
        "init-session",
        "--name",
        "helper-1",
        "--root",
        "--mux-ref",
        "{}",
        "--json",
      ],
      cwd: CWD,
      deps,
      io,
    });
    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(io.outText());
    expect(parsed).toMatchObject({
      workspaceId: SCOPE.workspaceId,
      worktreeRoot: SCOPE.worktreeRoot,
    });
    expect(typeof parsed.token).toBe("string");
    expect(typeof parsed.sessionId).toBe("string");
  });
});

describe("runCli session create", () => {
  /** Minimal `herdr tab create` JSON the builtin herdr mux template captures. */
  const HERDR_CREATE_JSON = JSON.stringify({
    result: { root_pane: { pane_id: "pane-1" }, tab: { tab_id: "tab-1" } },
  });

  /** Deps whose mux `create` step yields capturable refs so a launch succeeds. */
  function createDeps(options: { store?: FakeStore } = {}) {
    const store = options.store ?? new FakeStore();
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader(),
      scopeResolver: new FakeScopeResolver(SCOPE),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
      templateRunner: new FakeTemplateRunner({
        commands: [{ stdout: HERDR_CREATE_JSON }],
      }),
    });
    return { deps, store };
  }

  test("delegates to createSession and renders the created Session", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      ["session", "create", "reviewer-1", "--prompt", "do it", "--root"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("created reviewer-1");
    expect(io.outText()).toContain("running");
    // The operation — not the CLI — persisted the Session.
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]!.name).toBe("reviewer-1");
    expect(store.sessions[0]!.parentSessionId).toBeNull();
  });

  test("--parent <id> launches under an explicit in-scope parent", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "p_1", name: "parent" }));
    const { deps } = createDeps({ store });

    const { io, code } = await run(
      ["session", "create", "child-1", "--prompt", "go", "--parent", "p_1"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("parent: p_1");
    const child = store.sessions.find((s) => s.name === "child-1");
    expect(child?.parentSessionId).toBe("p_1");
  });

  test("--json prints the created Session as JSON", async () => {
    const { deps } = createDeps();
    const { io, code } = await run(
      ["session", "create", "helper-1", "--prompt", "x", "--root", "--json"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(io.outText());
    expect(parsed).toMatchObject({
      name: "helper-1",
      status: "running",
      parentSessionId: null,
      workspaceId: SCOPE.workspaceId,
      worktreeRoot: SCOPE.worktreeRoot,
    });
  });

  test("no parent flag and no current Session surfaces a structured error", async () => {
    const { deps, store } = createDeps();
    const { io, code } = await run(
      ["session", "create", "orphan", "--prompt", "x"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
    // A failed create must never leave a Session row (principle 5).
    expect(store.sessions).toHaveLength(0);
  });

  test("a same-scope name conflict surfaces session_name_conflict (exit 1)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "dup" }));
    const { deps } = createDeps({ store });

    const { io, code } = await run(
      ["session", "create", "dup", "--prompt", "x", "--root"],
      deps,
    );
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_name_conflict");
  });
});

describe("runCli session list/get", () => {
  test("renders one row per session in scope", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ name: "alpha" }),
      makeSession({ name: "beta" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "list"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("alpha");
    expect(io.outText()).toContain("beta");
  });

  test("does not list sessions from a sibling worktree (scope owned by ops)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ name: "here" }));
    store.sessions.push(
      makeSession({
        name: "there",
        workspaceId: SCOPE_SIBLING.workspaceId,
        worktreeRoot: SCOPE_SIBLING.worktreeRoot,
      }),
    );
    const { deps } = makeCliFixture({ store });

    const { io } = await run(["session", "list"], deps);
    expect(io.outText()).toContain("here");
    expect(io.outText()).not.toContain("there");
  });

  test("empty scope renders a friendly message", async () => {
    const { io } = await run(["session", "list"]);
    expect(io.outText()).toContain("no sessions in scope");
  });

  test("--refresh delegates liveness to the probe (no CLI-side status logic)", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);
    const probe = new FakeLivenessProbe().set(s.id, "exited");
    const deps = makeOpsDeps({
      store,
      scopeResolver: new FakeScopeResolver(SCOPE),
      livenessProbe: probe,
    });

    const { io } = await run(["session", "get", s.id, "--refresh"], deps);
    expect(probe.probed).toEqual([s.id]);
    expect(io.outText()).toContain("exited");
  });

  test("get renders detail and omits the token hash", async () => {
    const store = new FakeStore();
    const s = makeSession({
      name: "detail-1",
      tokenHash: "sha256:secret-hash",
    });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "get", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("detail-1");
    expect(io.outText()).not.toContain("secret-hash");
  });

  test("get of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["session", "get", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session attach", () => {
  test("renders human attach guidance via get_session (no MCP attach)", async () => {
    const store = new FakeStore();
    const s = makeSession({ name: "att-1", mux: "tmux" });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "attach", s.id], deps);
    expect(code).toBe(EXIT_OK);
    // No attach operation exists; the CLI renders what get_session returns.
    expect(io.outText()).toContain(s.id);
    expect(io.outText()).toContain("tmux");
  });

  test("renders the rendered attach hint when the mux ref supplies one", async () => {
    const store = new FakeStore();
    const s = makeSession({ mux: "herdr", muxRef: { pane_id: "w-7" } });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "attach", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("herdr agent attach 'w-7'");
  });

  test("attach of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { code, io } = await run(["session", "attach", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session close", () => {
  test("delegates to close_session and renders the closed result", async () => {
    const store = new FakeStore();
    const s = makeSession({
      name: "to-close",
      mux: "herdr",
      muxRef: { pane_id: "pane-1" },
    });
    store.sessions.push(s);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "close", s.id], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(s.id);
    expect(io.outText()).toContain("closed");
    // The operation — not the CLI — updated the stored status.
    expect(store.sessions[0]!.status).toBe("closed");
    expect(store.sessions[0]!.closedAt).not.toBeNull();
  });

  test("close of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["session", "close", "ghost"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli session delete", () => {
  test("--force deletes the Session and its related Messages", async () => {
    const store = new FakeStore();
    const s = makeSession({ id: "s_del", name: "to-delete" });
    store.sessions.push(s);
    store.messages.push(
      makeMessage({ id: "m1", toSessionId: "s_del" }),
      makeMessage({ id: "m2", fromSessionId: "s_del", toSessionId: "s_o" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["session", "delete", "s_del", "--force"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("s_del");
    expect(io.outText()).toContain("2 related message");
    expect(store.sessions).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
  });

  test("without --force the operation refuses (confirmation maps at surface)", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_del", name: "to-delete" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["session", "delete", "s_del"], deps);
    // The CLI passes force=false through; the operation owns the refusal.
    expect(code).toBe(EXIT_USAGE);
    expect(io.errText()).toContain("invalid_input");
    expect(store.sessions).toHaveLength(1);
  });

  test("delete of an unknown id with --force surfaces session_not_found", async () => {
    const { io, code } = await run(["session", "delete", "ghost", "--force"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli message list", () => {
  test("renders scoped history", async () => {
    const store = new FakeStore();
    store.messages.push(makeMessage({ body: "first" }));
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(["message", "list"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("first");
  });

  test("--inbox returns only messages addressed to the current Session", async () => {
    const store = new FakeStore();
    const me = seedCurrentSession(store);
    store.messages.push(
      makeMessage({ toSessionId: me.id, body: "for-me" }),
      makeMessage({ toSessionId: "s_other", body: "not-me" }),
    );
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });

    const { io, code } = await run(["message", "list", "--inbox"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("for-me");
    expect(io.outText()).not.toContain("not-me");
  });

  test("--inbox without a current Session surfaces the auth error (exit 1)", async () => {
    const { io, code } = await run(["message", "list", "--inbox"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
  });

  test("--undelivered filters to messages with no delivered_at", async () => {
    const store = new FakeStore();
    store.messages.push(
      makeMessage({ body: "pending", deliveredAt: null }),
      makeMessage({ body: "done", deliveredAt: "2026-06-05T12:30:00.000Z" }),
    );
    const { deps } = makeCliFixture({ store });

    const { io } = await run(["message", "list", "--undelivered"], deps);
    expect(io.outText()).toContain("pending");
    expect(io.outText()).not.toContain("done");
  });
});

describe("runCli message send", () => {
  test("delegates to send_message and renders the delivered result", async () => {
    const store = new FakeStore();
    // A deliverable herdr target (its builtin `send` sequence resolves pane_id).
    const target = makeSession({
      name: "reviewer-1",
      mux: "herdr",
      muxRef: { pane_id: "pane-1" },
    });
    store.sessions.push(target);
    const { deps } = makeCliFixture({ store });

    const { io, code } = await run(
      ["message", "send", target.id, "--body", "ping"],
      deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain(target.id);
    expect(io.outText()).toContain("delivered at");
    // The operation — not the CLI — recorded the Message.
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.body).toBe("ping");
  });

  test("an unknown target surfaces session_not_found (exit 1)", async () => {
    const { io, code } = await run(["message", "send", "ghost", "--body", "x"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("session_not_found");
  });
});

describe("runCli report parent", () => {
  test("delivers a report to the current Session's parent", async () => {
    const store = new FakeStore();
    const parent = makeSession({
      name: "parent",
      mux: "herdr",
      muxRef: { pane_id: "pane-9" },
    });
    store.sessions.push(parent);
    // Seed a current Session whose token verifies and whose parent is `parent`.
    const me = seedCurrentSession(store);
    me.parentSessionId = parent.id;
    const { deps } = makeCliFixture({ store, current: { sessionId: me.id } });

    const { io, code } = await run(["report", "parent", "--body", "wip"], deps);
    expect(code).toBe(EXIT_OK);
    expect(io.outText()).toContain("report");
    expect(io.outText()).toContain(parent.id);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.kind).toBe("report");
    expect(store.messages[0]!.formattedBody).toContain("[asem report from");
  });

  test("no current Session surfaces current_session_not_found (exit 1)", async () => {
    const { io, code } = await run(["report", "parent", "--body", "x"]);
    expect(code).toBe(EXIT_ERROR);
    expect(io.errText()).toContain("current_session_not_found");
  });
});
