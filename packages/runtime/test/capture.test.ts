import { describe, expect, test } from "bun:test";
import type { CaptureSpec } from "../src/index.ts";
import { applyCapture, evaluateJsonPath } from "../src/index.ts";

const regexSpec = (over: Partial<CaptureSpec> = {}): CaptureSpec =>
  ({
    name: "v",
    source: "stdout",
    regex: "id=(\\w+)",
    group: 1,
    ...over,
  }) as CaptureSpec;

describe("applyCapture — regex", () => {
  test("captures the requested group from stdout", () => {
    const out = applyCapture(regexSpec(), "id=abc123\n", "");
    expect(out).toEqual({ ok: true, value: "abc123" });
  });

  test("group 0 captures the whole match", () => {
    const out = applyCapture(
      {
        name: "v",
        source: "stdout",
        regex: "id=\\w+",
        group: 0,
      } as CaptureSpec,
      "id=abc",
      "",
    );
    expect(out).toEqual({ ok: true, value: "id=abc" });
  });

  test("reads from stderr when source is stderr", () => {
    const out = applyCapture(
      { name: "v", source: "stderr", regex: "(\\d+)", group: 1 } as CaptureSpec,
      "",
      "code 42",
    );
    expect(out).toEqual({ ok: true, value: "42" });
  });

  test("fails when the pattern does not match", () => {
    const out = applyCapture(regexSpec(), "no match here", "");
    expect(out.ok).toBe(false);
  });

  test("fails when the requested group is absent", () => {
    const out = applyCapture(regexSpec({ group: 5 }), "id=abc", "");
    expect(out.ok).toBe(false);
  });
});

describe("applyCapture — jsonpath", () => {
  const json = JSON.stringify({
    pane: { id: "p1", index: 3 },
    panes: [{ id: "first" }, { id: "second" }],
    enabled: true,
  });

  test("captures a nested string value", () => {
    const out = applyCapture(
      { name: "v", source: "stdout", jsonpath: "$.pane.id" } as CaptureSpec,
      json,
      "",
    );
    expect(out).toEqual({ ok: true, value: "p1" });
  });

  test("stringifies a non-string scalar", () => {
    const out = applyCapture(
      { name: "v", source: "stdout", jsonpath: "$.pane.index" } as CaptureSpec,
      json,
      "",
    );
    expect(out).toEqual({ ok: true, value: "3" });
  });

  test("indexes into arrays and bracketed keys", () => {
    const out = applyCapture(
      {
        name: "v",
        source: "stdout",
        jsonpath: "$.panes[1]['id']",
      } as CaptureSpec,
      json,
      "",
    );
    expect(out).toEqual({ ok: true, value: "second" });
  });

  test("fails on a missing path", () => {
    const out = applyCapture(
      {
        name: "v",
        source: "stdout",
        jsonpath: "$.pane.missing",
      } as CaptureSpec,
      json,
      "",
    );
    expect(out.ok).toBe(false);
  });

  test("fails when the source is not valid JSON", () => {
    const out = applyCapture(
      { name: "v", source: "stdout", jsonpath: "$.a" } as CaptureSpec,
      "not json",
      "",
    );
    expect(out.ok).toBe(false);
  });
});

describe("evaluateJsonPath", () => {
  test("returns the root for $", () => {
    expect(evaluateJsonPath("$", { a: 1 })).toEqual({
      found: true,
      value: { a: 1 },
    });
  });

  test("rejects a path without a leading $", () => {
    expect(evaluateJsonPath("a.b", { a: { b: 1 } })).toEqual({ found: false });
  });

  test("out-of-range array index is not found", () => {
    expect(evaluateJsonPath("$[2]", [1, 2])).toEqual({ found: false });
  });
});
