/**
 * JSON-config MCP target adapters.
 *
 * Paths and entry schemas mirror mikan's installers, which are verified against
 * real installs of each client. Only the asem server name/spec differ. Codex is
 * a TOML target handled separately in `codex.ts`.
 */
import {
  homePath,
  integrationTargetError,
  isGlobalScope,
  workspacePath,
} from "../shared.ts";
import type { JsonMcpTargetAdapter } from "./json-adapter.ts";

export const jsonMcpTargets: JsonMcpTargetAdapter[] = [
  {
    target: "pi",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".config", "mcp", "mcp.json"),
            scope: "global",
          }
        : { path: workspacePath(options, ".mcp.json"), scope: "workspace" },
    buildEntry: (spec) => ({ command: spec.command, args: [...spec.args] }),
  },
  {
    target: "claude-code",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".claude.json"), scope: "global" }
        : { path: workspacePath(options, ".mcp.json"), scope: "workspace" },
    buildEntry: (spec) => ({ command: spec.command, args: [...spec.args] }),
  },
  {
    target: "jcode",
    serversKey: "servers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".jcode", "mcp.json"), scope: "global" }
        : {
            path: workspacePath(options, ".jcode", "mcp.json"),
            scope: "workspace",
          },
    buildEntry: (spec) => ({
      command: spec.command,
      args: [...spec.args],
      env: { ...spec.env },
      shared: true,
    }),
  },
  {
    target: "opencode",
    serversKey: "mcp",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".config", "opencode", "opencode.json"),
            scope: "global",
          }
        : {
            path: workspacePath(options, "opencode.json"),
            scope: "workspace",
          },
    buildEntry: (spec) => ({
      type: "local",
      command: [spec.command, ...spec.args],
      enabled: true,
      environment: { ...spec.env },
    }),
  },
  {
    target: "antigravity",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(
              options,
              ".gemini",
              "antigravity-cli",
              "mcp_config.json",
            ),
            scope: "cli-global",
          }
        : {
            path: workspacePath(options, ".agents", "mcp_config.json"),
            scope: "workspace",
          },
    buildEntry: (spec) => ({
      command: spec.command,
      args: [...spec.args],
      env: { ...spec.env },
    }),
  },
  {
    target: "copilot-vscode",
    serversKey: "servers",
    resolveTarget: (options) => {
      if (isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "copilot-vscode does not support global MCP scope; re-run with --no-global to register asem in .vscode/mcp.json",
        );
      }
      return {
        path: workspacePath(options, ".vscode", "mcp.json"),
        scope: "workspace",
      };
    },
    buildEntry: (spec) => {
      const entry: Record<string, unknown> = {
        type: "stdio",
        command: spec.command,
        args: [...spec.args],
      };
      if (Object.keys(spec.env).length > 0) entry.env = { ...spec.env };
      return entry;
    },
  },
  {
    target: "copilot-cli",
    serversKey: "mcpServers",
    resolveTarget: (options) => {
      if (!isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "copilot-cli does not support workspace MCP scope; re-run without --no-global to register asem in ~/.copilot/mcp-config.json",
        );
      }
      return {
        path: homePath(options, ".copilot", "mcp-config.json"),
        scope: "global",
      };
    },
    buildEntry: (spec) => ({
      type: "local",
      command: spec.command,
      args: [...spec.args],
      env: { ...spec.env },
      tools: ["*"],
    }),
  },
];
