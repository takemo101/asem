#!/usr/bin/env bun
/**
 * `@asem/mcp` — stdio MCP server that projects shared operations as MCP tools.
 *
 * MCP is an AI-facing surface projection. It maps JSON-RPC tool requests to
 * shared `@asem/ops` handlers and returns structured tool results. It does not
 * expose attach and does not duplicate domain logic.
 */
export const PACKAGE_NAME = "@asem/mcp";

export type { JsonRpcRequest, JsonRpcResponse } from "./jsonrpc.ts";
export type { McpServerOptions } from "./server.ts";
export { handleMcpLine, handleMcpRequest, runMcpStdio } from "./server.ts";
export type { McpToolDefinition, McpToolResult } from "./tools.ts";
export { callMcpTool, hasMcpTool, listMcpTools } from "./tools.ts";
