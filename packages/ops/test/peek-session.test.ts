import { describe, expect, test } from "bun:test";
import { hashToken } from "@asem/core";
import { FakeTemplateRunner } from "@asem/runtime";
import { peekSession } from "../src/index.ts";
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
const CURRENT_TOKEN = "tok_current";

function depsWith(
  store: FakeStore,
  runner: FakeTemplateRunner,
  muxTemplate: unknown,
) {
  return makeOpsDeps({
    store,
    templateRunner: runner,
    scopeResolver: new FakeScopeResolver(scopeA),
    configLoader: new FakeConfigLoader({
      kind: "found",
      config: makeConfig({
        mux: { default: "herdr", templates: { herdr: muxTemplate } },
      }),
      configPath: "/repo/.asem.yaml",
    }),
  });
}

function peekTemplate(
  command = "peek {{pane_id}} {{peek_source}} {{peek_lines}}",
) {
  return { peek: [{ type: "run", command }] };
}

describe("peekSession", () => {
  test("reads a live pane snapshot with default source and lines", async () => {
    const store = new FakeStore();
    const target = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "snapshot\n" }],
    });

    const result = expectOk(
      await peekSession(
        depsWith(store, runner, peekTemplate()),
        { id: target.id },
        CTX,
      ),
    );

    expect(result).toMatchObject({
      session: { id: target.id },
      source: "recent-unwrapped",
      lines: 80,
      content: "snapshot\n",
    });
    expect(runner.commands[0]?.command).toBe("peek p1 recent-unwrapped 80");
  });

  test("accepts explicit source and lines", async () => {
    const store = new FakeStore();
    const target = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "visible" }],
    });

    const result = expectOk(
      await peekSession(
        depsWith(store, runner, peekTemplate()),
        { id: target.id, source: "visible", lines: 12 },
        CTX,
      ),
    );

    expect(result.source).toBe("visible");
    expect(result.lines).toBe(12);
    expect(runner.commands[0]?.command).toBe("peek p1 visible 12");
  });

  test("MCP agent origin can peek another Session in the same Workspace", async () => {
    const store = new FakeStore();
    const current = makeSession({
      id: "current",
      tokenHash: hashToken(CURRENT_TOKEN),
    });
    const target = makeSession({
      id: "target",
      worktreeRoot: scopeB.worktreeRoot,
      cwd: scopeB.worktreeRoot,
      muxRef: { pane_id: "p2" },
    });
    store.sessions.push(current, target);
    const runner = new FakeTemplateRunner({ commands: [{ stdout: "child" }] });
    const deps = depsWith(store, runner, peekTemplate());
    deps.currentSessionResolver = new FakeCurrentSessionResolver({
      sessionId: current.id,
      token: CURRENT_TOKEN,
      scope: scopeA,
    });

    const result = expectOk(
      await peekSession(deps, { id: target.id }, { ...CTX, origin: "agent" }),
    );

    expect(result.content).toBe("child");
  });

  test("returns session_not_found for another Workspace", async () => {
    const store = new FakeStore();
    const target = makeSession({ workspaceId: "other_ws" });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner();

    expectErr(
      await peekSession(
        depsWith(store, runner, peekTemplate()),
        { id: target.id },
        CTX,
      ),
      "session_not_found",
    );
    expect(runner.commands).toHaveLength(0);
  });

  test("missing peek sequence is unsupported", async () => {
    const store = new FakeStore();
    const target = makeSession();
    store.sessions.push(target);
    const runner = new FakeTemplateRunner();

    expectErr(
      await peekSession(depsWith(store, runner, {}), { id: target.id }, CTX),
      "mux_peek_unsupported",
    );
  });

  test("exit code 42 maps to unsupported_source", async () => {
    const store = new FakeStore();
    const target = makeSession({
      status: "running",
      muxRef: { pane_id: "p1" },
    });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 42, stderr: "unsupported" }],
    });

    expectErr(
      await peekSession(
        depsWith(store, runner, peekTemplate()),
        { id: target.id, source: "recent-unwrapped" },
        CTX,
      ),
      "unsupported_source",
    );
  });

  test("passes logger and redactor through sequence failures", async () => {
    const store = new FakeStore();
    const target = makeSession({ muxRef: { pane_id: "p1" } });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ fail: "secret-token unreachable" }],
    });
    const logger = new MemoryLogger();
    const deps = depsWith(store, runner, peekTemplate());
    deps.logger = logger;
    deps.redactor = {
      redact: (value) => value.replaceAll("secret-token", "[REDACTED]"),
    };

    const result = expectErr(
      await peekSession(deps, { id: target.id }, CTX),
      "peek_failed",
    );

    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(logger.entries)).not.toContain("secret-token");
    expect(JSON.stringify(logger.entries)).toContain("[REDACTED]");
  });

  test("peek failure does not mutate Session status", async () => {
    const store = new FakeStore();
    const target = makeSession({ status: "running" });
    store.sessions.push(target);
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "gone" }],
    });

    expectErr(
      await peekSession(
        depsWith(store, runner, peekTemplate()),
        { id: target.id },
        CTX,
      ),
      "peek_failed",
    );
    const stored = await store.getSessionById(scopeA, target.id);
    expect(stored?.status).toBe("running");
  });
});
