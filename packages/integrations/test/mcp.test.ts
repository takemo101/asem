import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installMcpServerForTarget } from "../src/mcp/index.ts";

const allTargets = [
  "pi",
  "antigravity",
  "jcode",
  "claude-code",
  "opencode",
  "codex",
  "copilot-vscode",
  "copilot-cli",
] as const;

describe("installMcpServerForTarget", () => {
  test("supports the mikan parity target set", () => {
    const home = mktemp();
    for (const target of allTargets) {
      const result = installMcpServerForTarget(target, {
        home,
        cwd: join(home, "repo"),
        global: target !== "copilot-vscode",
      });
      expect(result.target).toBe(target);
      expect(result.serverName).toBe("asem");
      expect(result.path.length).toBeGreaterThan(0);
    }
  });

  test("pi global writes mcpServers.asem at ~/.config/mcp/mcp.json", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("pi", { home });
    expect(result).toEqual({
      target: "pi",
      path: join(home, ".config", "mcp", "mcp.json"),
      scope: "global",
      serverName: "asem",
    });
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
  });

  test("claude-code workspace writes .mcp.json", () => {
    const cwd = join(mktemp(), "repo");
    const result = installMcpServerForTarget("claude-code", {
      cwd,
      global: false,
    });
    expect(result.path).toBe(join(cwd, ".mcp.json"));
    expect(result.scope).toBe("workspace");
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
  });

  test("jcode uses the `servers` key with a shared stdio entry", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("jcode", { home });
    expect(result.path).toBe(join(home, ".jcode", "mcp.json"));
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      servers: {
        asem: { command: "asem", args: ["mcp"], env: {}, shared: true },
      },
    });
  });

  test("opencode uses the `mcp` key with an array command entry", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("opencode", { home });
    expect(result.path).toBe(
      join(home, ".config", "opencode", "opencode.json"),
    );
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcp: {
        asem: {
          type: "local",
          command: ["asem", "mcp"],
          enabled: true,
          environment: {},
        },
      },
    });
  });

  test("opencode workspace writes opencode.json at the project root", () => {
    const cwd = join(mktemp(), "repo");
    const result = installMcpServerForTarget("opencode", {
      cwd,
      global: false,
    });
    expect(result.path).toBe(join(cwd, "opencode.json"));
    expect(result.scope).toBe("workspace");
  });

  test("antigravity global writes the cli-global mcp_config.json", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("antigravity", { home });
    expect(result.path).toBe(
      join(home, ".gemini", "antigravity-cli", "mcp_config.json"),
    );
    expect(result.scope).toBe("cli-global");
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"], env: {} } },
    });
  });

  test("copilot-cli global writes ~/.copilot/mcp-config.json with tools", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("copilot-cli", { home });
    expect(result.path).toBe(join(home, ".copilot", "mcp-config.json"));
    expect(result.scope).toBe("global");
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: {
        asem: {
          type: "local",
          command: "asem",
          args: ["mcp"],
          env: {},
          tools: ["*"],
        },
      },
    });
  });

  test("copilot-vscode workspace writes .vscode/mcp.json as a stdio server", () => {
    const cwd = join(mktemp(), "repo");
    const result = installMcpServerForTarget("copilot-vscode", {
      cwd,
      global: false,
    });
    expect(result.path).toBe(join(cwd, ".vscode", "mcp.json"));
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      servers: { asem: { type: "stdio", command: "asem", args: ["mcp"] } },
    });
  });

  test("copilot-vscode rejects global scope", () => {
    expect(() =>
      installMcpServerForTarget("copilot-vscode", { home: mktemp() }),
    ).toThrow("copilot-vscode does not support global MCP scope");
  });

  test("copilot-cli rejects workspace scope", () => {
    expect(() =>
      installMcpServerForTarget("copilot-cli", {
        cwd: mktemp(),
        global: false,
      }),
    ).toThrow("copilot-cli does not support workspace MCP scope");
  });

  test("upserts only the asem entry and preserves other servers", () => {
    const home = mktemp();
    const path = join(home, ".config", "mcp", "mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: { other: { command: "other" }, asem: { command: "old" } },
      }),
    );
    installMcpServerForTarget("pi", { home });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: {
        other: { command: "other" },
        asem: { command: "asem", args: ["mcp"] },
      },
    });
  });

  test("invalid existing JSON fails rather than overwriting", () => {
    const home = mktemp();
    const path = join(home, ".config", "mcp", "mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    expect(() => installMcpServerForTarget("pi", { home })).toThrow(
      "Invalid JSON",
    );
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  test("codex global appends an [mcp_servers.asem] table", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("codex", { home });
    expect(result.path).toBe(join(home, ".codex", "config.toml"));
    expect(result.scope).toBe("global");
    const toml = readFileSync(result.path, "utf8");
    expect(toml).toContain("[mcp_servers.asem]");
    expect(toml).toContain('command = "asem"');
    expect(toml).toContain('args = ["mcp"]');
  });

  test("codex upserts the asem table while preserving other content", () => {
    const home = mktemp();
    const path = join(home, ".codex", "config.toml");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      '# my config\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "other"\n',
    );
    installMcpServerForTarget("codex", { home });
    const toml = readFileSync(path, "utf8");
    expect(toml).toContain('model = "o3"');
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml).toContain("[mcp_servers.asem]");
  });

  test("codex rejects a parent-table asem form rather than corrupting it", () => {
    const home = mktemp();
    const path = join(home, ".codex", "config.toml");
    mkdirSync(dirname(path), { recursive: true });
    const original = '[mcp_servers]\nasem = { command = "old" }\n';
    writeFileSync(path, original);
    expect(() => installMcpServerForTarget("codex", { home })).toThrow(
      "cannot safely merge",
    );
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("codex rejects a dotted asem key rather than corrupting it", () => {
    const home = mktemp();
    const path = join(home, ".codex", "config.toml");
    mkdirSync(dirname(path), { recursive: true });
    const original = 'mcp_servers.asem.command = "old"\n';
    writeFileSync(path, original);
    expect(() => installMcpServerForTarget("codex", { home })).toThrow(
      "cannot safely merge",
    );
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("codex still upserts when a canonical asem table coexists with a parent table", () => {
    const home = mktemp();
    const path = join(home, ".codex", "config.toml");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.asem]\ncommand = "old"\n',
    );
    installMcpServerForTarget("codex", { home });
    const toml = readFileSync(path, "utf8");
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml).toContain("[mcp_servers.asem]");
    expect(toml).toContain('command = "asem"');
    expect(toml).not.toContain('command = "old"');
  });

  test("codex rejects workspace scope", () => {
    expect(() =>
      installMcpServerForTarget("codex", { cwd: mktemp(), global: false }),
    ).toThrow("codex does not support workspace MCP scope");
  });

  test("unknown target fails", () => {
    expect(() => installMcpServerForTarget("nope", { home: mktemp() })).toThrow(
      "Unknown Integration Target: nope",
    );
  });
});

function mktemp(): string {
  return join(tmpdir(), `asem-integrations-${crypto.randomUUID()}`);
}
