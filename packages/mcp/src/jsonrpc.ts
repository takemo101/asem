/**
 * Minimal JSON-RPC 2.0 message shapes for the MCP stdio transport.
 *
 * MCP speaks JSON-RPC 2.0; the stdio transport frames each message as one line
 * of JSON. These types are intentionally small — only what `@asem/mcp` needs to
 * answer `initialize`, `tools/list`, `tools/call`, and `ping`. This module is
 * pure transport framing and owns no operation semantics.
 */

/** A JSON-RPC id is a string or number; notifications omit it entirely. */
export type JsonRpcId = string | number | null;

/** An incoming request or notification (notifications have no `id`). */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

/** Standard JSON-RPC error codes used by the server. */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A JSON-RPC response carries exactly one of `result` or `error`. */
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * Parse and shallowly validate an incoming line as a JSON-RPC request. Returns
 * `null` for anything that is not a well-formed request object so the caller can
 * answer with a parse/invalid-request error.
 */
export function parseJsonRpc(line: string): JsonRpcRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { jsonrpc?: unknown }).jsonrpc !== "2.0" ||
    typeof (value as { method?: unknown }).method !== "string"
  ) {
    return null;
  }
  return value as JsonRpcRequest;
}

/** True when a request is a notification (no `id`): it expects no response. */
export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}
