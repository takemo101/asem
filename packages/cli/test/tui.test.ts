import { describe, expect, test } from "bun:test";
import { parseTuiScope } from "../src/tui.ts";

describe("parseTuiScope", () => {
  test("defaults to workspace scope with no flags (ADR 0004)", () => {
    const result = parseTuiScope([]);
    expect(result).toEqual({ ok: true, value: "workspace" });
  });

  test("accepts --scope worktree and --scope workspace", () => {
    expect(parseTuiScope(["--scope", "worktree"])).toEqual({
      ok: true,
      value: "worktree",
    });
    expect(parseTuiScope(["--scope", "workspace"])).toEqual({
      ok: true,
      value: "workspace",
    });
  });

  test("accepts --scope=workspace form", () => {
    expect(parseTuiScope(["--scope=workspace"])).toEqual({
      ok: true,
      value: "workspace",
    });
  });

  test("rejects an unknown scope value", () => {
    const result = parseTuiScope(["--scope", "all"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });

  test("rejects unknown options", () => {
    const result = parseTuiScope(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });
});
