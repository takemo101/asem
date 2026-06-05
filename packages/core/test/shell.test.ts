import { describe, expect, test } from "bun:test";
import { shellEscape, shellEscapeAll } from "../src/index.ts";

describe("shellEscape", () => {
  test("wraps a simple value in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  test("escapes an empty string to a quoted empty token", () => {
    expect(shellEscape("")).toBe("''");
  });

  test("preserves spaces inside quotes", () => {
    expect(shellEscape("a b c")).toBe("'a b c'");
  });

  test("escapes embedded single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  test("escapes multiple single quotes", () => {
    expect(shellEscape("'''")).toBe("''\\'''\\'''\\'''");
  });

  test("leaves shell metacharacters literal inside quotes", () => {
    expect(shellEscape("$(rm -rf /); `whoami` && echo $HOME")).toBe(
      "'$(rm -rf /); `whoami` && echo $HOME'",
    );
  });
});

describe("shellEscapeAll", () => {
  test("escapes and space-joins values", () => {
    expect(shellEscapeAll(["a", "b c", "d'e"])).toBe("'a' 'b c' 'd'\\''e'");
  });

  test("returns an empty string for no values", () => {
    expect(shellEscapeAll([])).toBe("");
  });
});
