import { describe, expect, test } from "bun:test";
import { makeOpsDeps } from "../../ops/src/testing/fakes.ts";
import { handleMcpLine, handleMcpRequest } from "../src/index.ts";

const context = { cwd: "/repo", deps: makeOpsDeps() };

describe("MCP JSON-RPC server", () => {
  test("initialize advertises tool capability", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      context,
    );
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { capabilities: { tools: {} }, serverInfo: { name: "asem" } },
    });
  });

  test("tools/list returns MVP tools without attach_session", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: "tools", method: "tools/list" },
      context,
    );
    expect(response && "result" in response).toBe(true);
    const result = (response as { result: { tools: { name: string }[] } })
      .result;
    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain("init_session");
    expect(names).toContain("close_session");
    expect(names).not.toContain("attach_session");
  });

  test("tools/call validates params shape", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: {} },
      context,
    );
    expect(response).toMatchObject({
      error: { code: -32602, message: "tools/call requires a tool name" },
    });
  });

  test("invalid JSON line returns parse error", async () => {
    const response = await handleMcpLine("{not json", context);
    expect(response).toMatchObject({
      error: { code: -32700, message: "invalid JSON-RPC request" },
    });
  });

  test("notifications produce no response", async () => {
    const response = await handleMcpRequest(
      { jsonrpc: "2.0", method: "ping" },
      context,
    );
    expect(response).toBeNull();
  });
});
