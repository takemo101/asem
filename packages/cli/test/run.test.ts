import { describe, expect, test } from "bun:test";
import { configPathFor } from "@asem/ops";
import {
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

  test("attach of an unknown id surfaces session_not_found (exit 1)", async () => {
    const { code, io } = await run(["session", "attach", "ghost"]);
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
