import { describe, expect, test } from "bun:test";
import { toKeyEvent } from "../src/opentui/keys.ts";

describe("toKeyEvent", () => {
  test("maps navigation and special keys", () => {
    expect(toKeyEvent({ name: "up" })).toEqual({ key: "up" });
    expect(toKeyEvent({ name: "down" })).toEqual({ key: "down" });
    expect(toKeyEvent({ name: "tab" })).toEqual({ key: "tab" });
    expect(toKeyEvent({ name: "escape" })).toEqual({ key: "escape" });
    expect(toKeyEvent({ name: "backspace" })).toEqual({ key: "backspace" });
  });

  test("plain Enter is return; linefeed-style Enter is Ctrl+Enter", () => {
    expect(toKeyEvent({ name: "return", sequence: "\r" })).toEqual({
      key: "return",
    });
    expect(toKeyEvent({ name: "return", sequence: "\n" })).toEqual({
      key: "return",
      ctrl: true,
    });
    expect(toKeyEvent({ name: "linefeed", sequence: "\n" })).toEqual({
      key: "return",
      ctrl: true,
    });
    expect(toKeyEvent({ name: "return", ctrl: true })).toEqual({
      key: "return",
      ctrl: true,
    });
  });

  test("printable characters pass through with shift preserved", () => {
    expect(toKeyEvent({ name: "q", sequence: "q" })).toEqual({ key: "q" });
    expect(toKeyEvent({ name: "d", sequence: "D", shift: true })).toEqual({
      key: "D",
      shift: true,
    });
    expect(toKeyEvent({ sequence: "?" })).toEqual({ key: "?" });
  });

  test("ctrl+letter maps to a ctrl key event", () => {
    expect(toKeyEvent({ name: "c", sequence: "\x03", ctrl: true })).toEqual({
      key: "c",
      ctrl: true,
    });
  });

  test("meta chords and unknown keys are ignored", () => {
    expect(toKeyEvent({ name: "f1" })).toBeNull();
    expect(toKeyEvent({ name: "a", sequence: "a", meta: true })).toBeNull();
  });
});
