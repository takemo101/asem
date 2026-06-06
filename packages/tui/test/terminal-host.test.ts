import { describe, expect, test } from "bun:test";
import {
  createCockpitState,
  decodeKeys,
  renderCockpitView,
  renderFrame,
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
});
