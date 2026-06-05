import { describe, expect, test } from "bun:test";
import {
  createMemoryLogger,
  createRedactor,
  redactFields,
  withRedaction,
} from "../src/index.ts";

describe("createRedactor", () => {
  test("masks a configured secret", () => {
    const r = createRedactor(["s3cr3t"]);
    expect(r.redact("token=s3cr3t end")).toBe("token=*** end");
  });

  test("masks every occurrence of multiple secrets", () => {
    const r = createRedactor(["aaa", "bbb"]);
    expect(r.redact("aaa-bbb-aaa")).toBe("***-***-***");
  });

  test("ignores empty secrets", () => {
    const r = createRedactor(["", "x"]);
    expect(r.redact("axb")).toBe("a***b");
  });

  test("masks longer overlapping secrets first", () => {
    const r = createRedactor(["abc", "abcdef"]);
    expect(r.redact("abcdef")).toBe("***");
  });
});

describe("redactFields", () => {
  test("redacts string values and leaves non-strings intact", () => {
    const r = createRedactor(["tok"]);
    expect(redactFields(r, { a: "tok!", b: 5, c: true })).toEqual({
      a: "***!",
      b: 5,
      c: true,
    });
  });
});

describe("withRedaction", () => {
  test("redacts log messages and string fields before logging", () => {
    const { logger, entries } = createMemoryLogger();
    const redacting = withRedaction(logger, createRedactor(["SEKRET"]));
    redacting.error("failed with SEKRET", { detail: "had SEKRET", n: 1 });
    expect(entries).toEqual([
      {
        level: "error",
        message: "failed with ***",
        fields: { detail: "had ***", n: 1 },
      },
    ]);
  });
});
