import { describe, expect, test } from "bun:test";
import { BufferIo } from "../src/io.ts";
import {
  createReadOnlyCliDeps,
  surfaceForArgv,
  wantsHelp,
} from "../src/main.ts";
import { runCli } from "../src/run.ts";

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

describe("read-only CLI deps", () => {
  test("doctor runs without durable store access", async () => {
    const deps = createReadOnlyCliDeps({ surface: "cli" });
    const io = new BufferIo();

    const code = await runCli({ argv: ["doctor"], cwd: "/tmp", deps, io });

    expect(code).toBe(0);
    expect(io.outText()).toContain("asem doctor");
    expect(() => deps.store.listSessions).toThrow(
      "store is unavailable in read-only CLI deps",
    );
  });
});

describe("wantsHelp", () => {
  test("detects --help, -h, and bare help so tui/mcp fall through", () => {
    expect(wantsHelp(["tui", "--help"])).toBe(true);
    expect(wantsHelp(["mcp", "-h"])).toBe(true);
    expect(wantsHelp(["tui", "help"])).toBe(true);
  });

  test("plain tui/mcp invocations are not help requests", () => {
    expect(wantsHelp(["tui"])).toBe(false);
    expect(wantsHelp(["tui", "--scope", "worktree"])).toBe(false);
    expect(wantsHelp(["mcp"])).toBe(false);
  });
});
