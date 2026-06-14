/**
 * Shared read/merge/write runner for JSON-config Integration Targets.
 *
 * Every JSON target stores MCP servers in a top-level map keyed by a server
 * name. This runner owns the read -> upsert-only-`asem` -> atomic-write flow so
 * each target adapter encodes only its config path, its servers key, and how the
 * fixed asem server spec maps to that target's entry schema.
 */
import {
  type InstallOptions,
  type InstallResult,
  type InstallScope,
  type IntegrationTarget,
  type JsonObject,
  objectProperty,
  readJsonObject,
  writeJsonObjectAtomic,
} from "../shared.ts";

/** The fixed MVP server name; setup never exposes a flag to change it. */
export const SERVER_NAME = "asem";

/** The fixed MVP stdio server spec (no `--command`/`--args`/env flags). */
export type McpServerSpec = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

export const FIXED_SERVER_SPEC: McpServerSpec = {
  command: "asem",
  args: ["mcp"],
  env: {},
};

export type McpServerEntry = JsonObject;

export type McpInstallResult = InstallResult & {
  serverName: string;
};

export type JsonMcpTargetAdapter = {
  target: IntegrationTarget;
  serversKey: string;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
  buildEntry(spec: McpServerSpec): McpServerEntry;
};

export function installJsonMcpServer(
  adapter: JsonMcpTargetAdapter,
  options: InstallOptions,
): McpInstallResult {
  const { path, scope } = adapter.resolveTarget(options);
  const config = readJsonObject(path);
  const servers = objectProperty(config, adapter.serversKey);
  servers[SERVER_NAME] = adapter.buildEntry(FIXED_SERVER_SPEC);
  config[adapter.serversKey] = servers;
  writeJsonObjectAtomic(path, config);
  return { target: adapter.target, path, scope, serverName: SERVER_NAME };
}
