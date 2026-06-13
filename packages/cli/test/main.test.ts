import { describe, expect, test } from "bun:test";
import { surfaceForArgv } from "../src/main.ts";

describe("surfaceForArgv", () => {
  test("asem mcp selects the mcp surface", () => {
    expect(surfaceForArgv(["mcp"])).toBe("mcp");
  });

  test("asem tui selects the tui surface", () => {
    expect(surfaceForArgv(["tui"])).toBe("tui");
  });

  test("no subcommand defaults to the cli surface", () => {
    expect(surfaceForArgv([])).toBe("cli");
  });

  test("a normal CLI command selects the cli surface", () => {
    expect(surfaceForArgv(["session", "list"])).toBe("cli");
  });
});
