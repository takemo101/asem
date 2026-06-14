/**
 * MCP installer registry and dispatch.
 *
 * `installMcpServerForTarget` registers the fixed asem MCP server entry in one
 * Integration Target's local config. Codex is a TOML target; every other target
 * is a JSON map adapter. Unknown targets fail with a stable error.
 */
import { type InstallOptions, integrationTargetError } from "../shared.ts";
import { installCodexMcpServer } from "./codex.ts";
import { installJsonMcpServer, type McpInstallResult } from "./json-adapter.ts";
import { jsonMcpTargets } from "./targets.ts";

export type { McpInstallResult, McpServerSpec } from "./json-adapter.ts";

export function installMcpServerForTarget(
  target: string,
  options: InstallOptions = {},
): McpInstallResult {
  if (target === "codex") return installCodexMcpServer(options);
  const adapter = jsonMcpTargets.find((entry) => entry.target === target);
  if (!adapter) {
    throw integrationTargetError(
      "unknown_target",
      `Unknown Integration Target: ${target}`,
    );
  }
  return installJsonMcpServer(adapter, options);
}
