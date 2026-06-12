import { describe, expect, test } from "bun:test";
import {
  AnsiCockpitHost,
  createCockpitState,
  decodeKeys,
  dispatchCockpit,
  renderCockpitView,
  renderFrame,
  type TtyInput,
  type TtyOutput,
} from "../src/index.ts";
import { makeEnv, makeSession } from "./helpers.ts";

describe("decodeKeys", () => {
  test("decodes arrow keys, Tab, Enter and Ctrl+Enter", () => {
    expect(decodeKeys("\x1b[A")).toEqual([{ key: "up" }]);
    expect(decodeKeys("\x1b[B")).toEqual([{ key: "down" }]);
    expect(decodeKeys("\t")).toEqual([{ key: "tab" }]);
    expect(decodeKeys("\r")).toEqual([{ key: "return" }]);
    expect(decodeKeys("\n")).toEqual([{ key: "return", ctrl: true }]);
  });

  test("decodes Escape, Backspace, and printable characters", () => {
    expect(decodeKeys("\x1b")).toEqual([{ key: "escape" }]);
    expect(decodeKeys("\x7f")).toEqual([{ key: "backspace" }]);
    expect(decodeKeys("ab")).toEqual([{ key: "a" }, { key: "b" }]);
  });

  test("decodes Ctrl+letter", () => {
    expect(decodeKeys("\x03")).toEqual([{ key: "c", ctrl: true }]);
  });
});

class FakeInput implements TtyInput {
  rawMode = false;
  resumed = false;
  listener: ((chunk: Buffer | string) => void) | null = null;

  setRawMode(mode: boolean): void {
    this.rawMode = mode;
  }

  resume(): void {
    this.resumed = true;
  }

  pause(): void {
    this.resumed = false;
  }

  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.listener = listener;
  }

  off(_event: "data", listener: (chunk: Buffer | string) => void): void {
    if (this.listener === listener) {
      this.listener = null;
    }
  }
}

class FakeOutput implements TtyOutput {
  rows?: number;
  columns?: number;
  writes: string[] = [];
  resizeListener: (() => void) | null = null;

  write(text: string): void {
    this.writes.push(text);
  }

  on(_event: "resize", listener: () => void): void {
    this.resizeListener = listener;
  }

  off(_event: "resize", listener: () => void): void {
    if (this.resizeListener === listener) {
      this.resizeListener = null;
    }
  }
}

function frameLinesFromWrite(write: string): string[] {
  const clearPrefix = "\x1b[2J\x1b[H";
  const withoutClear = write.startsWith(clearPrefix)
    ? write.slice(clearPrefix.length)
    : write;
  const withoutTrailingNewline = withoutClear.endsWith("\n")
    ? withoutClear.slice(0, -1)
    : withoutClear;
  return withoutTrailingNewline.split("\n");
}

describe("renderFrame", () => {
  test("paints the two-pane layout, keybar, and modal", () => {
    const state = createCockpitState(makeEnv(), {
      sessions: [makeSession({ id: "s1", name: "one" })],
      messages: [],
    });
    const frame = renderFrame(renderCockpitView(state));
    expect(frame).toContain("Sessions");
    expect(frame).toContain("one");
    expect(frame).toContain("[Messages]");
    expect(frame).toContain("attach");
    // The vertical pane divider is present.
    expect(frame).toContain("│");
  });

  test("clips pane content to reserve the bottom keybar", () => {
    let state = createCockpitState(makeEnv(), {
      sessions: [makeSession({ id: "s1", name: "one" })],
      messages: [],
    });
    state = dispatchCockpit(state, { type: "switchTab" }).state;
    const frame = renderFrame(renderCockpitView(state), {
      rows: 8,
      columns: 160,
    });
    const lines = frame.split("\n");

    expect(lines).toHaveLength(8);
    expect(lines.at(-1)).toContain("[q] quit");
    expect(frame).toContain("[Detail]");
    expect(frame).toContain("id:");
    expect(frame).not.toContain("attach_hint:");
  });

  test("redraws the last frame when the terminal is resized", () => {
    let state = createCockpitState(makeEnv(), {
      sessions: [makeSession({ id: "s1", name: "one" })],
      messages: [],
    });
    state = dispatchCockpit(state, { type: "switchTab" }).state;
    const input = new FakeInput();
    const output = new FakeOutput();
    output.rows = 20;
    output.columns = 160;
    const host = new AnsiCockpitHost({ input, output });

    host.draw(renderCockpitView(state));
    output.rows = 8;
    output.resizeListener?.();

    expect(frameLinesFromWrite(output.writes.at(-1) ?? "")).toHaveLength(8);
    expect(output.writes.at(-1)).toContain("[q] quit");
    host.close();
    expect(output.resizeListener).toBeNull();
  });
});

describe("AnsiCockpitHost nextKeyOrTick", () => {
  test("resolves tick when no key arrives within the timeout", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const host = new AnsiCockpitHost({ input, output });

    const result = await host.nextKeyOrTick(5);
    expect(result).toBe("tick");
    host.close();
  });

  test("resolves the key and cancels the timer when input arrives first", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const host = new AnsiCockpitHost({ input, output });

    const pending = host.nextKeyOrTick(1_000);
    input.listener?.("j");
    expect(await pending).toEqual({ key: "j" });
    host.close();
  });

  test("drains queued keys before waiting for the timer", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const host = new AnsiCockpitHost({ input, output });

    // One chunk carries two keys: the first resolves the pending read, the
    // second is queued and drained without waiting on the timer.
    const pending = host.nextKeyOrTick(1_000);
    input.listener?.("jk");
    expect(await pending).toEqual({ key: "j" });
    expect(await host.nextKeyOrTick(1_000)).toEqual({ key: "k" });
    host.close();
  });

  test("close resolves a pending tick-capable read with null", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const host = new AnsiCockpitHost({ input, output });

    const pending = host.nextKeyOrTick(60_000);
    host.close();
    expect(await pending).toBeNull();
  });
});
