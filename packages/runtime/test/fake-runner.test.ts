import { describe, expect, test } from "bun:test";
import { FakeTemplateRunner, SequenceTimeoutError } from "../src/index.ts";

describe("FakeTemplateRunner", () => {
  test("records ordered command traces with metadata", async () => {
    const runner = new FakeTemplateRunner();
    await runner.run({
      command: "echo hi",
      cwd: "/work",
      env: { A: "1" },
      timeoutMs: 500,
    });
    expect(runner.commands).toEqual([
      {
        command: "echo hi",
        cwd: "/work",
        env: { A: "1" },
        timeoutMs: 500,
        background: false,
      },
    ]);
  });

  test("scripts stdout/stderr/exit code per call in FIFO order", async () => {
    const runner = new FakeTemplateRunner({
      commands: [
        { stdout: "one", exitCode: 0 },
        { stderr: "boom", exitCode: 2 },
      ],
    });
    expect(await runner.run({ command: "a" })).toEqual({
      stdout: "one",
      stderr: "",
      exitCode: 0,
    });
    expect(await runner.run({ command: "b" })).toEqual({
      stdout: "",
      stderr: "boom",
      exitCode: 2,
    });
  });

  test("returns deterministic background handles", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{}, { backgroundHandle: "custom" }],
    });
    const first = await runner.run({ command: "a", background: true });
    const second = await runner.run({ command: "b", background: true });
    expect(first.backgroundHandle).toBe("bg-1");
    expect(second.backgroundHandle).toBe("custom");
  });

  test("does not set a handle for foreground runs", async () => {
    const runner = new FakeTemplateRunner();
    const result = await runner.run({ command: "a" });
    expect(result.backgroundHandle).toBeUndefined();
  });

  test("injects a generic failure by throwing", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ fail: "kaboom" }] });
    await expect(runner.run({ command: "a" })).rejects.toThrow("kaboom");
  });

  test("forces a timeout when scripted", async () => {
    const runner = new FakeTemplateRunner({ commands: [{ timeout: true }] });
    await expect(
      runner.run({ command: "a", timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(SequenceTimeoutError);
  });

  test("times out when virtual duration exceeds the request timeout", async () => {
    const runner = new FakeTemplateRunner({
      commands: [{ durationMs: 300 }],
    });
    await expect(
      runner.run({ command: "a", timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(SequenceTimeoutError);
    // Virtual time advanced by the timeout budget, not the full duration.
    expect(runner.clock.now()).toBe(100);
  });

  test("advances virtual time for wait()", async () => {
    const runner = new FakeTemplateRunner({ startTimeMs: 1000 });
    await runner.wait(250);
    await runner.wait(50);
    expect(runner.clock.now()).toBe(1300);
    expect(runner.waits).toEqual([250, 50]);
  });

  test("records a unified event order across run/write/wait", async () => {
    const runner = new FakeTemplateRunner();
    await runner.run({ command: "a" });
    await runner.writeFile("/tmp/x", "data", { mode: 0o600 });
    await runner.wait(10);
    await runner.run({ command: "b", background: true });
    expect(runner.events).toEqual([
      { type: "run", command: "a", background: false },
      { type: "write_file", path: "/tmp/x" },
      { type: "wait_ms", ms: 10 },
      { type: "run", command: "b", background: true },
    ]);
    expect(runner.writes).toEqual([
      { path: "/tmp/x", contents: "data", mode: 0o600 },
    ]);
  });

  test("injects a write failure", async () => {
    const runner = new FakeTemplateRunner({ writes: [{ fail: "disk full" }] });
    await expect(runner.writeFile("/x", "y")).rejects.toThrow("disk full");
  });
});
