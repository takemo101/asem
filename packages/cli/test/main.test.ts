import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BufferIo } from "../src/io.ts";
import {
  createReadOnlyCliDeps,
  isReadOnlyCommand,
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

  test("mcp add is a cli command, not the mcp server surface", () => {
    expect(surfaceForArgv(["mcp", "add", "--for", "pi"])).toBe("cli");
  });
});

describe("isReadOnlyCommand", () => {
  test("setup commands, version, and doctor/help are read-only (no durable store)", () => {
    expect(isReadOnlyCommand(["doctor"])).toBe(true);
    expect(isReadOnlyCommand(["--version"])).toBe(true);
    expect(isReadOnlyCommand(["-v"])).toBe(true);
    expect(isReadOnlyCommand(["--version", "--json"])).toBe(true);
    expect(isReadOnlyCommand(["-v", "extra"])).toBe(true);
    expect(isReadOnlyCommand(["mcp", "add", "--for", "pi"])).toBe(true);
    expect(isReadOnlyCommand(["skills", "add", "--for", "pi"])).toBe(true);
    expect(isReadOnlyCommand(["session", "list", "--help"])).toBe(true);
  });

  test("the bare mcp server and normal commands need full deps", () => {
    expect(isReadOnlyCommand(["mcp"])).toBe(false);
    expect(isReadOnlyCommand(["session", "list"])).toBe(false);
  });
});

describe("integration setup is store-free", () => {
  test("mcp add runs against read-only deps and writes only target config", async () => {
    const home = join(tmpdir(), `asem-main-${crypto.randomUUID()}`);
    const deps = createReadOnlyCliDeps({ surface: "cli" });
    const io = new BufferIo();

    const code = await runCli({
      argv: ["mcp", "add", "--for", "pi"],
      cwd: join(home, "repo"),
      deps,
      io,
      home,
    });

    expect(code).toBe(0);
    expect(io.outText()).toContain("Registered MCP server 'asem' for pi");
    expect(() => deps.store.listSessions).toThrow(
      "store is unavailable in read-only CLI deps",
    );
    const path = join(home, ".config", "mcp", "mcp.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
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
