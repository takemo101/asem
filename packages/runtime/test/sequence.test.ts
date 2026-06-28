import { describe, expect, test } from "bun:test";
import type { CommandSequence } from "../src/index.ts";
import {
  createMemoryLogger,
  createRedactor,
  FakeTemplateRunner,
  SequenceEngine,
  withRedaction,
} from "../src/index.ts";

function engine(runner: FakeTemplateRunner, extra = {}) {
  return new SequenceEngine({ runner, ...extra });
}

describe("SequenceEngine — ordering", () => {
  test("runs steps strictly in order", async () => {
    const runner = new FakeTemplateRunner();
    const steps: CommandSequence = [
      { type: "run", command: "first" },
      { type: "write_file", path: "/p", contents: "c" },
      { type: "wait_ms", ms: 5 },
      { type: "run", command: "last" },
    ];
    const result = await engine(runner).run(steps);
    expect(result.ok).toBe(true);
    expect(runner.events).toEqual([
      { type: "run", command: "first", background: false },
      { type: "write_file", path: "/p" },
      { type: "wait_ms", ms: 5 },
      { type: "run", command: "last", background: false },
    ]);
  });
});

describe("SequenceEngine — cwd/env propagation", () => {
  test("applies context defaults and step overrides", async () => {
    const runner = new FakeTemplateRunner();
    const steps: CommandSequence = [
      { type: "run", command: "a" },
      { type: "run", command: "b", cwd: "/override", env: { X: "2" } },
    ];
    await engine(runner).run(steps, {
      cwd: "/base",
      env: { X: "1", Y: "keep" },
      defaultTimeoutMs: 1000,
    });
    expect(runner.commands[0]).toMatchObject({
      cwd: "/base",
      env: { X: "1", Y: "keep" },
      timeoutMs: 1000,
    });
    expect(runner.commands[1]).toMatchObject({
      cwd: "/override",
      env: { X: "2", Y: "keep" },
      timeoutMs: 1000,
    });
  });

  test("interpolates env values against captured variables", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "p1" }, {}],
    });
    const steps: CommandSequence = [
      {
        type: "run",
        command: "get-id",
        capture: [{ name: "pane", regex: "^(.+)$", group: 1 }],
      },
      { type: "run", command: "use", env: { PANE: "{{pane}}" } },
    ];
    await engine(runner).run(steps);
    expect(runner.commands[1]?.env).toEqual({ PANE: "p1" });
  });
});

describe("SequenceEngine — interpolation", () => {
  test("interpolates raw and shell-escaped command variables", async () => {
    const runner = new FakeTemplateRunner();
    const steps: CommandSequence = [
      { type: "run", command: "send {{message_shell}} to {{name}}" },
    ];
    await engine(runner).run(steps, {
      variables: { message: "a b", name: "r1" },
    });
    expect(runner.commands[0]?.command).toBe("send 'a b' to r1");
  });

  test("a missing variable fails the step", async () => {
    const runner = new FakeTemplateRunner();
    const result = await engine(runner).run([
      { type: "run", command: "{{missing}}" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("sequence_step_failed");
    }
  });

  test("write_file interpolates path and contents", async () => {
    const runner = new FakeTemplateRunner();
    await engine(runner).run(
      [{ type: "write_file", path: "{{dir}}/prompt.md", contents: "{{body}}" }],
      { variables: { dir: "/s", body: "hello" } },
    );
    expect(runner.writes[0]).toEqual({
      path: "/s/prompt.md",
      contents: "hello",
      mode: undefined,
    });
  });
});

describe("SequenceEngine — final stdout", () => {
  test("returns the last foreground run stdout", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "first" }, { stdout: "snapshot\n" }],
    });
    const result = await engine(runner).runForFinalStdout(
      [
        { type: "run", command: "prepare" },
        { type: "run", command: "peek {{peek_lines}}" },
      ],
      {
        variables: { peek_lines: "80" },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stdout).toBe("snapshot\n");
    }
    expect(runner.commands[1]?.command).toBe("peek 80");
  });

  test("ignores background run stdout when selecting final stdout", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "visible" }, { stdout: "background" }],
    });
    const result = await engine(runner).runForFinalStdout([
      { type: "run", command: "visible" },
      { type: "run", command: "bg", background: true },
    ]);
    expect(result.ok && result.value.stdout).toBe("visible");
  });
});

describe("SequenceEngine — capture", () => {
  test("captures regex output and forwards it to later steps", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "pane=p42\n" }, {}],
    });
    const result = await engine(runner).run([
      {
        type: "run",
        command: "create",
        capture: [{ name: "pane", regex: "pane=(\\w+)", group: 1 }],
      },
      { type: "run", command: "send {{pane}}" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.captures).toEqual({ pane: "p42" });
    }
    expect(runner.commands[1]?.command).toBe("send p42");
  });

  test("captures a JSONPath value", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: JSON.stringify({ pane: { id: "x9" } }) }],
    });
    const result = await engine(runner).run([
      {
        type: "run",
        command: "create",
        capture: [{ name: "id", jsonpath: "$.pane.id" }],
      },
    ]);
    expect(result.ok && result.value.captures).toEqual({ id: "x9" });
  });

  test("a capture miss returns capture_failed", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ stdout: "nope" }] });
    const result = await engine(runner).run([
      {
        type: "run",
        command: "create",
        capture: [{ name: "pane", regex: "pane=(\\w+)", group: 1 }],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("capture_failed");
      expect(result.error.details).toMatchObject({ name: "pane" });
    }
  });
});

describe("SequenceEngine — background", () => {
  test("collects background handles in order", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{}, { backgroundHandle: "h2" }],
    });
    const result = await engine(runner).run([
      { type: "run", command: "a", background: true },
      { type: "run", command: "b", background: true },
    ]);
    expect(result.ok && result.value.backgroundHandles).toEqual(["bg-1", "h2"]);
    expect(runner.commands.every((c) => c.background)).toBe(true);
  });
});

describe("SequenceEngine — timeout & virtual time", () => {
  test("wait_ms advances virtual time without real delay", async () => {
    const runner = new FakeTemplateRunner({ startTimeMs: 100 });
    await engine(runner).run([{ type: "wait_ms", ms: 250 }]);
    expect(runner.clock.now()).toBe(350);
  });

  test("a step exceeding its timeout returns the timeout error", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ durationMs: 900 }] });
    const result = await engine(runner).run([
      { type: "run", command: "slow", timeout_ms: 100 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("timeout");
      expect(result.error.details).toMatchObject({ timeoutMs: 100 });
    }
  });
});

describe("SequenceEngine — failure injection & on_error", () => {
  test("a non-zero exit fails the sequence by default", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ exitCode: 3 }] });
    const result = await engine(runner).run([{ type: "run", command: "a" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("sequence_step_failed");
      expect(result.error.details).toMatchObject({ exitCode: 3 });
    }
  });

  test("a generic failure fails the sequence by default", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ fail: "boom" }] });
    const result = await engine(runner).run([{ type: "run", command: "a" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("sequence_step_failed");
    }
  });

  test("on_error: ignore continues past a failed step", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1 }, { stdout: "ok" }],
    });
    const result = await engine(runner).run([
      { type: "run", command: "maybe-fails", on_error: "ignore" },
      { type: "run", command: "after" },
    ]);
    expect(result.ok).toBe(true);
    expect(runner.commands).toHaveLength(2);
  });

  test("on_error: ignore also swallows capture failures", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "nope" }, {}],
    });
    const result = await engine(runner).run([
      {
        type: "run",
        command: "create",
        capture: [{ name: "pane", regex: "pane=(\\w+)", group: 1 }],
        on_error: "ignore",
      },
      { type: "run", command: "after" },
    ]);
    expect(result.ok).toBe(true);
    expect(runner.commands).toHaveLength(2);
  });

  test("a write_file failure fails the sequence", async () => {
    const runner = new FakeTemplateRunner({ writes: [{ fail: "no space" }] });
    const result = await engine(runner).run([
      { type: "write_file", path: "/p", contents: "c" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("sequence_step_failed");
    }
  });
});

describe("SequenceEngine — redaction", () => {
  test("redacts configured secrets from structured error details", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ exitCode: 1, stderr: "auth failed for TOKEN123" }],
    });
    const result = await engine(runner, {
      redactor: createRedactor(["TOKEN123"]),
    }).run([{ type: "run", command: "login --token TOKEN123" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.details?.command).toBe("login --token ***");
      expect(result.error.details?.stderr).toBe("auth failed for ***");
    }
  });

  test("redacts secrets from emitted logs", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ exitCode: 1 }] });
    const { logger, entries } = createMemoryLogger();
    const redactor = createRedactor(["SECRET"]);
    await engine(runner, {
      redactor,
      logger: withRedaction(logger, redactor),
    }).run([{ type: "run", command: "run SECRET" }]);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("SECRET");
    expect(entries.length).toBeGreaterThan(0);
  });
});
