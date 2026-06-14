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
  // env is intentionally omitted: FIXED_SERVER_SPEC.env is fixed empty in the
  // MVP (setup exposes no env flag), so there is nothing to render. If a future
  // design makes env configurable, add an `env = { ... }` line here.
  const { command, args } = FIXED_SERVER_SPEC;
  return [
    header,
    `command = ${tomlBasicString(command)}`,
    `args = [${args.map(tomlBasicString).join(", ")}]`,
  ].join("\n");
}

/**
 * Detect an existing `asem` server defined via the non-canonical parent-table or
 * dotted forms — `[mcp_servers]` with an `asem = { ... }` assignment, or a dotted
 * `mcp_servers.asem...` key. {@link upsertCodexAsemTable} only matches the
 * canonical `[mcp_servers.asem]` header, so appending our table next to one of
 * these forms would emit a duplicate `asem` key and produce invalid TOML. We
 * detect and reject instead of corrupting the file. Mirrors mikan's codex guard.
 */
export function hasUnsafeAsemDefinition(existing: string): boolean {
  if (/^\s*mcp_servers\s*\.\s*asem\b/m.test(existing)) return true;
  const assignment = /^\s*asem\s*[.=]/;
  let inParentTable = false;
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inParentTable = trimmed === "[mcp_servers]";
      continue;
    }
    if (inParentTable && assignment.test(line)) return true;
  }
  return false;
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
  // Only the canonical `[mcp_servers.asem]` table can be upserted safely. If asem
  // is instead defined via a parent-table/dotted form, fail without writing
  // rather than corrupt the file with a duplicate key.
  const hasCanonicalTable = existing
    .split("\n")
    .some((line) => line.trim() === header);
  if (!hasCanonicalTable && hasUnsafeAsemDefinition(existing)) {
    throw integrationTargetError(
      "invalid_config",
      `Found an existing 'asem' MCP server in ${path} defined under a [mcp_servers] table form asem cannot safely merge. Edit that entry manually or use \`codex mcp add\` instead.`,
      path,
    );
  }
  writeTextFileAtomic(path, upsertCodexAsemTable(existing));
  return { target, path, scope: "global", serverName: "asem" };
}
