import { describe, expect, test } from "bun:test";
import {
  interpolate,
  interpolateValues,
  MissingVariableError,
} from "../src/index.ts";

describe("interpolate", () => {
  test("substitutes a raw variable", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe(
      "hello world",
    );
  });

  test("tolerates surrounding whitespace in the placeholder", () => {
    expect(interpolate("{{  name  }}", { name: "x" })).toBe("x");
  });

  test("shell-escapes the _shell variant via the core primitive", () => {
    expect(interpolate("echo {{message_shell}}", { message: "a b" })).toBe(
      "echo 'a b'",
    );
  });

  test("escapes embedded single quotes in the _shell variant", () => {
    expect(interpolate("{{message_shell}}", { message: "it's" })).toBe(
      "'it'\\''s'",
    );
  });

  test("raw and shell variants of the same variable differ", () => {
    const vars = { message: "$(whoami)" };
    expect(interpolate("{{message}}", vars)).toBe("$(whoami)");
    expect(interpolate("{{message_shell}}", vars)).toBe("'$(whoami)'");
  });

  test("an explicit _shell variable overrides the derived form", () => {
    expect(
      interpolate("{{message_shell}}", {
        message: "raw",
        message_shell: "explicit",
      }),
    ).toBe("explicit");
  });

  test("throws MissingVariableError for an unknown variable", () => {
    expect(() => interpolate("{{nope}}", {})).toThrow(MissingVariableError);
  });

  test("replaces multiple placeholders", () => {
    expect(
      interpolate("{{cwd_shell}} :: {{name}}", { cwd: "/a b", name: "n" }),
    ).toBe("'/a b' :: n");
  });
});

describe("interpolateValues", () => {
  test("interpolates every value but leaves keys literal", () => {
    expect(
      interpolateValues({ KEY: "{{v}}", OTHER: "lit" }, { v: "val" }),
    ).toEqual({ KEY: "val", OTHER: "lit" });
  });
});
