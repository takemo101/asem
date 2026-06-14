import { describe, expect, test } from "bun:test";
import {
  type EffectiveScope,
  hashToken,
  type Message,
  type Session,
} from "@asem/core";
import { getSession, listSessions } from "@asem/ops";
import {
  FakeCurrentSessionResolver,
  FakeStore,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import { callMcpTool, hasMcpTool, listMcpTools } from "../src/index.ts";

const scope: EffectiveScope = { workspaceId: "ws_1", worktreeRoot: "/repo" };
const ctx = { cwd: scope.worktreeRoot };
const CURRENT_TOKEN = "tok_current";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s_1",
    name: "agent-1",
    workspaceId: scope.workspaceId,
    worktreeRoot: scope.worktreeRoot,
    parentSessionId: null,
    agent: "claude",
    mux: "herdr",
    model: null,
    muxRef: { pane_id: "pane-1" },
    sessionDir: `${scope.worktreeRoot}/.asem/sessions/s_1`,
    cwd: scope.worktreeRoot,
    status: "running",
    tokenHash: hashToken(CURRENT_TOKEN),
    createdAt: "2026-06-05T12:00:00.000Z",
    updatedAt: "2026-06-05T12:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m_1",
    workspaceId: scope.workspaceId,
    worktreeRoot: scope.worktreeRoot,
    fromSessionId: null,
    toSessionId: "s_1",
    kind: "message",
    body: "hello",
    formattedBody: "[asem message] hello",
    deliveredAt: null,
    deliveryError: null,
    createdAt: "2026-06-05T12:00:00.000Z",
    ...overrides,
  };
}

function text(result: { content: { text: string }[] }): string {
  return result.content.map((part) => part.text).join("\n");
}

function parsed(result: { content: { text: string }[] }): unknown {
  return JSON.parse(text(result));
}

function withCurrentSession(
  store: FakeStore,
  current: Session = makeSession(),
) {
  if (!store.sessions.some((s) => s.id === current.id)) {
    store.sessions.push(current);
  }
  return makeOpsDeps({
    store,
    currentSessionResolver: new FakeCurrentSessionResolver({
      sessionId: current.id,
      token: CURRENT_TOKEN,
      scope,
    }),
  });
}

describe("MCP tool registry", () => {
  test("exposes MVP operation tools and never exposes attach_session", () => {
    const names = listMcpTools()
      .map((tool) => tool.name)
      .sort();
    expect(names).toEqual([
      "close_session",
      "create_session",
      "delete_session",
      "get_session",
      "init_session",
      "list_messages",
      "list_sessions",
      "report_parent",
      "send_message",
    ]);
    expect(hasMcpTool("attach_session")).toBe(false);
  });

  test("tools publish object input schemas", () => {
    for (const tool of listMcpTools()) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  test("create_session input schema exposes an optional model", () => {
    const tool = listMcpTools().find((t) => t.name === "create_session");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("model");
    expect(schema.properties.model).toMatchObject({ type: "string" });
    // model is optional: it is not in the required list.
    expect(schema.required).not.toContain("model");
  });
});

describe("MCP tool calls", () => {
  test("list_sessions delegates to the same agent-origin ops handler as direct operation calls", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.sessions.push(makeSession({ id: "s_1" }));
    const deps = withCurrentSession(store, current);

    const mcp = await callMcpTool("list_sessions", {}, { ...ctx, deps });
    const direct = await listSessions(deps, {}, { ...ctx, origin: "agent" });

    expect(mcp.isError).toBeUndefined();
    expect(parsed(mcp)).toEqual(direct.ok ? direct.value : direct.error);
  });

  test("get_session preserves attach_hint returned by agent-origin ops", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.sessions.push(makeSession({ id: "s_get" }));
    const deps = withCurrentSession(store, current);

    const result = await callMcpTool(
      "get_session",
      { id: "s_get" },
      { ...ctx, deps },
    );
    const direct = await getSession(
      deps,
      { id: "s_get" },
      { ...ctx, origin: "agent" },
    );

    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toEqual(direct.ok ? direct.value : direct.error);
  });

  test("schema parse failures return structured invalid_input without echoing raw arguments", async () => {
    const deps = makeOpsDeps();
    const result = await callMcpTool(
      "send_message",
      { toSessionId: "s_1", body: 123, token: "tok_secret" },
      { ...ctx, deps },
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("invalid_input");
    expect(text(result)).not.toContain("tok_secret");
  });

  test("MCP reads require a current Session instead of falling back to human local trust", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s_1" }));
    const deps = makeOpsDeps({ store });

    const result = await callMcpTool("list_sessions", {}, { ...ctx, deps });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("current_session_not_found");
  });

  test("MCP mutations require a current Session instead of falling back to human local trust", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "target" }));
    const deps = makeOpsDeps({ store });

    const result = await callMcpTool(
      "send_message",
      { toSessionId: "target", body: "hello" },
      { ...ctx, deps },
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("current_session_not_found");
    expect(store.messages).toHaveLength(0);
  });

  test("operation auth errors are returned as structured tool errors without token leakage", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "s_1", tokenHash: hashToken("other") }),
    );
    const deps = makeOpsDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: "s_1",
        token: "tok_secret",
        scope,
      }),
    });

    const result = await callMcpTool(
      "report_parent",
      { body: "status" },
      { ...ctx, deps },
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("invalid_session_token");
    expect(text(result)).not.toContain("tok_secret");
  });

  test("message send delegates delivery through ops and records the Message", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.sessions.push(makeSession({ id: "target", name: "target" }));
    const deps = withCurrentSession(store, current);

    const result = await callMcpTool(
      "send_message",
      { toSessionId: "target", body: "hello" },
      { ...ctx, deps },
    );

    expect(result.isError).toBeUndefined();
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.body).toBe("hello");
    expect(store.messages[0]?.fromSessionId).toBe("current");
  });

  test("delete_session preserves ops force semantics", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.sessions.push(makeSession({ id: "s_delete", status: "closed" }));
    store.messages.push(
      makeMessage({ id: "m_delete", toSessionId: "s_delete" }),
    );
    const deps = withCurrentSession(store, current);

    const refused = await callMcpTool(
      "delete_session",
      { id: "s_delete" },
      { ...ctx, deps },
    );
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("invalid_input");
    expect(store.sessions.map((s) => s.id).sort()).toEqual([
      "current",
      "s_delete",
    ]);

    const deleted = await callMcpTool(
      "delete_session",
      { id: "s_delete", force: true },
      { ...ctx, deps },
    );
    expect(deleted.isError).toBeUndefined();
    expect(parsed(deleted)).toMatchObject({
      deletedSessionId: "s_delete",
      deletedMessageCount: 1,
    });
    expect(store.sessions.map((s) => s.id)).toEqual(["current"]);
  });
});
