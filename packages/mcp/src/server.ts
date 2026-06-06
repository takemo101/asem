/**
 * Minimal stdio MCP server for asem.
 *
 * This is a JSON-RPC transport adapter. It implements the small MCP method set
 * needed for MVP (`initialize`, `tools/list`, `tools/call`, `ping`) and delegates
 * every tool call to `tools.ts`, which in turn delegates to `@asem/ops`.
 */
import type { OpsDeps } from "@asem/ops";
import {
  isNotification,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  parseJsonRpc,
  rpcError,
  rpcResult,
} from "./jsonrpc.ts";
import { callMcpTool, listMcpTools } from "./tools.ts";

export interface McpServerOptions {
  cwd: string;
  deps: OpsDeps;
}

interface ToolsCallParams {
  name: string;
  arguments?: unknown;
}

const SERVER_INFO = { name: "asem", version: "0.0.0" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidParams(id: JsonRpcId, message: string): JsonRpcResponse {
  return rpcError(id, JSON_RPC_INVALID_PARAMS, message);
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  options: McpServerOptions,
): Promise<JsonRpcResponse | null> {
  if (isNotification(request)) return null;
  const id = request.id ?? null;

  switch (request.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: listMcpTools() });
    case "tools/call": {
      if (!isObject(request.params)) {
        return invalidParams(id, "tools/call params must be an object");
      }
      const params = request.params as Partial<ToolsCallParams>;
      if (typeof params.name !== "string" || params.name.length === 0) {
        return invalidParams(id, "tools/call requires a tool name");
      }
      const result = await callMcpTool(params.name, params.arguments, options);
      return rpcResult(id, result);
    }
    default:
      return rpcError(
        id,
        JSON_RPC_METHOD_NOT_FOUND,
        `method not found: ${request.method}`,
      );
  }
}

export async function handleMcpLine(
  line: string,
  options: McpServerOptions,
): Promise<JsonRpcResponse | null> {
  const request = parseJsonRpc(line);
  if (request === null) {
    return rpcError(null, JSON_RPC_PARSE_ERROR, "invalid JSON-RPC request");
  }
  try {
    return await handleMcpRequest(request, options);
  } catch (error) {
    return rpcError(
      request.id ?? null,
      JSON_RPC_INTERNAL_ERROR,
      "internal MCP server error",
      { message: error instanceof Error ? error.message : String(error) },
    );
  }
}

/**
 * Run the line-delimited stdio server. The tests exercise handlers in-process;
 * this function is the binary transport loop used by `asem mcp`.
 */
export async function runMcpStdio(options: McpServerOptions): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        const response = await handleMcpLine(line, options);
        if (response !== null) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      }
      newline = buffer.indexOf("\n");
    }
  }

  const finalLine = buffer.trim();
  if (finalLine.length > 0) {
    const response = await handleMcpLine(finalLine, options);
    if (response !== null)
      process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
