/**
 * Codex MCP installer.
 *
 * Codex config is TOML at ~/.codex/config.toml; each MCP server is a
 * `[mcp_servers.<name>]` table. Codex MCP config is global-only, so workspace
 * scope is rejected. The upsert replaces an existing `[mcp_servers.asem]` table
 * in place or appends a new one, leaving all other TOML (including comments)
 * untouched. This mirrors mikan's codex installer, fixed to the asem spec.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  homePath,
  type InstallOptions,
  type IntegrationTarget,
  integrationTargetError,
  isGlobalScope,
  writeTextFileAtomic,
} from "../shared.ts";
import { FIXED_SERVER_SPEC, type McpInstallResult } from "./json-adapter.ts";

const target: IntegrationTarget = "codex";
const header = "[mcp_servers.asem]";

function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderAsemTable(): string {
  const { command, args } = FIXED_SERVER_SPEC;
  return [
    header,
    `command = ${tomlBasicString(command)}`,
    `args = [${args.map(tomlBasicString).join(", ")}]`,
  ].join("\n");
}

/** Replace an existing `[mcp_servers.asem]` table in place, or append a new one. */
export function upsertCodexAsemTable(existing: string): string {
  const table = renderAsemTable();
  const lines = existing.split("\n");
  const startIdx = lines.findIndex((line) => line.trim() === header);
  if (startIdx === -1) {
    const trimmed = existing.replace(/\s*$/, "");
    return trimmed.length > 0 ? `${trimmed}\n\n${table}\n` : `${table}\n`;
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim().startsWith("[")) {
      endIdx = i;
      break;
    }
  }
  const merged = [
    ...lines.slice(0, startIdx),
    ...table.split("\n"),
    ...lines.slice(endIdx),
  ];
  const result = merged.join("\n");
  return result.endsWith("\n") ? result : `${result}\n`;
}

export function installCodexMcpServer(
  options: InstallOptions,
): McpInstallResult {
  if (!isGlobalScope(options)) {
    throw integrationTargetError(
      "unsupported_scope",
      "codex does not support workspace MCP scope; re-run without --no-global to register asem in ~/.codex/config.toml",
    );
  }
  const path = homePath(options, ".codex", "config.toml");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeTextFileAtomic(path, upsertCodexAsemTable(existing));
  return { target, path, scope: "global", serverName: "asem" };
}
