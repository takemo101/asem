/**
 * `@asem/mcp` — stdio MCP server that projects shared operations as MCP tools.
 *
 * Scaffold only (MIK-001). Tool projection lands in a later slice. MCP tool
 * handlers map request/response only and delegate to `@asem/ops`; MCP does not
 * expose attach and does not duplicate domain logic.
 */
import type { OperationResult } from "@asem/core";

export const PACKAGE_NAME = "@asem/mcp";

export type { OperationResult };
