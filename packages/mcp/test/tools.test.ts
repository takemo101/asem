import { describe, expect, test } from "bun:test";
import {
  type EffectiveScope,
  hashToken,
  type Message,
  type Session,
} from "@asem/core";
import {
  getSession,
  listMessages,
  listProfiles,
  listSessions,
} from "@asem/ops";
import { FakeTemplateRunner } from "@asem/runtime";
import {
  FakeConfigLoader,
  FakeCurrentSessionResolver,
  type FakeSleeper,
  FakeStore,
  makeConfig,
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
    profile: null,
    profileSource: null,
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
      "get_profile",
      "get_session",
      "init_session",
      "list_messages",
      "list_profiles",
      "list_sessions",
      "peek_session",
      "report_parent",
      "send_message",
      "wait_messages",
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

  test("create_session input schema exposes an optional profile", () => {
    const tool = listMcpTools().find((t) => t.name === "create_session");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("profile");
    expect(schema.required).not.toContain("profile");
  });

  test("create_session input schema exposes an optional repo alias", () => {
    const tool = listMcpTools().find((t) => t.name === "create_session");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("repo");
    expect(schema.properties.repo).toMatchObject({ type: "string" });
    expect(schema.required).not.toContain("repo");
  });

  test("peek_session input schema exposes source and lines", () => {
    const tool = listMcpTools().find((t) => t.name === "peek_session");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toContain("id");
    expect(schema.properties).toHaveProperty("source");
    expect(schema.properties).toHaveProperty("lines");
  });

  test("close_session input schema exposes optional force", () => {
    const tool = listMcpTools().find((t) => t.name === "close_session");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("force");
    expect(schema.properties.force).toMatchObject({ type: "boolean" });
    expect(schema.required).toContain("id");
    expect(schema.required).not.toContain("force");
  });

  test("list_messages input schema exposes optional top-level cursor and limit", () => {
    const tool = listMcpTools().find((t) => t.name === "list_messages");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("cursor");
    expect(schema.properties.cursor).toMatchObject({ type: "string" });
    expect(schema.properties).toHaveProperty("limit");
    expect(schema.properties.limit).toMatchObject({ type: "number" });
    expect(schema.required).not.toContain("cursor");
    expect(schema.required).not.toContain("limit");
  });

  test("wait_messages input schema requires a cursor with optional limit and timeoutMs", () => {
    const tool = listMcpTools().find((t) => t.name === "wait_messages");
    const schema = tool?.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("cursor");
    expect(schema.properties.cursor).toMatchObject({ type: "string" });
    expect(schema.properties).toHaveProperty("limit");
    expect(schema.properties).toHaveProperty("timeoutMs");
    expect(schema.required).toContain("cursor");
    expect(schema.required).not.toContain("limit");
    expect(schema.required).not.toContain("timeoutMs");
  });

  test("wait_messages tells clients to set a tool-call deadline beyond timeoutMs", () => {
    const tool = listMcpTools().find((t) => t.name === "wait_messages");
    expect(tool?.description).toContain(
      "successful empty page with timedOut true",
    );
    const schema = tool?.inputSchema as {
      properties: { timeoutMs: { description: string } };
    };
    const timeoutMs = schema.properties.timeoutMs.description;
    expect(timeoutMs).toContain("default 30000, max 60000");
    expect(timeoutMs).toContain(
      "client tool-call deadline strictly longer than this value",
    );
    expect(timeoutMs).toContain("successful empty page, not an error");
  });

  test("get_profile requires an id", () => {
    const tool = listMcpTools().find((t) => t.name === "get_profile");
    const schema = tool?.inputSchema as { required: string[] };
    expect(schema.required).toContain("id");
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

  test("peek_session delegates to the same agent-origin ops handler", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    const target = makeSession({ id: "target", muxRef: { pane_id: "p1" } });
    store.sessions.push(target);
    const deps = withCurrentSession(store, current);
    deps.configLoader = new FakeConfigLoader({
      kind: "found",
      config: makeConfig({
        mux: {
          default: "herdr",
          templates: {
            herdr: {
              peek: [
                {
                  type: "run",
                  command: "peek {{pane_id}} {{peek_source}} {{peek_lines}}",
                },
              ],
            },
          },
        },
      }),
      configPath: "/repo/.asem.yaml",
    });
    deps.templateRunner = new FakeTemplateRunner({
      commands: [{ stdout: "snapshot" }],
    });

    const result = await callMcpTool(
      "peek_session",
      { id: "target", source: "visible", lines: 12 },
      { ...ctx, deps },
    );

    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({
      session: { id: "target" },
      source: "visible",
      lines: 12,
      content: "snapshot",
    });
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

  test("list_messages forwards top-level cursor/limit and pages without duplicates", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.messages.push(
      makeMessage({ id: "m_a", body: "first" }),
      makeMessage({ id: "m_b", body: "second" }),
      makeMessage({ id: "m_c", body: "third" }),
    );
    const deps = withCurrentSession(store, current);

    const first = parsed(
      await callMcpTool("list_messages", { limit: 2 }, { ...ctx, deps }),
    ) as { messages: { id: string }[]; nextCursor: string; hasMore: boolean };
    expect(first.messages.map((m) => m.id)).toEqual(["m_a", "m_b"]);
    expect(first.hasMore).toBe(true);

    const second = parsed(
      await callMcpTool(
        "list_messages",
        { cursor: first.nextCursor, limit: 2 },
        { ...ctx, deps },
      ),
    ) as { messages: { id: string }[]; hasMore: boolean };
    expect(second.messages.map((m) => m.id)).toEqual(["m_c"]);
    expect(second.hasMore).toBe(false);
  });

  test("list_messages returns the shared page envelope with only public Message fields", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.messages.push(
      makeMessage({
        id: "m_failed",
        deliveredAt: null,
        deliveryError: "notification_failed: pane gone",
      }),
    );
    const deps = withCurrentSession(store, current);

    const result = await callMcpTool("list_messages", {}, { ...ctx, deps });
    expect(result.isError).toBeUndefined();
    const page = parsed(result) as {
      messages: Record<string, unknown>[];
      nextCursor: string;
      hasMore: boolean;
    };
    expect(Object.keys(page).sort()).toEqual([
      "hasMore",
      "messages",
      "nextCursor",
    ]);
    expect(Object.keys(page.messages[0] ?? {}).sort()).toEqual([
      "body",
      "createdAt",
      "delivery",
      "fromSessionId",
      "id",
      "kind",
      "toSessionId",
    ]);
    // Internal fields never cross the surface, in any spelling.
    expect(text(result)).not.toContain("formattedBody");
    expect(text(result)).not.toContain("workspaceId");
    expect(text(result)).not.toContain("worktreeRoot");
    expect(text(result)).not.toContain("sequence");
  });

  test("list_messages result equals the shared ops page envelope (CLI parity)", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.messages.push(makeMessage({ id: "m_parity", body: "parity" }));
    const deps = withCurrentSession(store, current);

    const viaTool = parsed(
      await callMcpTool("list_messages", {}, { ...ctx, deps }),
    );
    const direct = await listMessages(deps, {}, { ...ctx, origin: "agent" });
    if (!direct.ok) throw new Error("direct listMessages failed");
    // JSON round-trip so the comparison sees exactly what the wire carries.
    expect(viaTool).toEqual(JSON.parse(JSON.stringify(direct.value)));
  });

  test("wait_messages returns arrivals in the current Session Inbox as a page", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    const deps = withCurrentSession(store, current);

    const anchor = parsed(
      await callMcpTool(
        "list_messages",
        { filter: { inbox: true } },
        { ...ctx, deps },
      ),
    ) as { nextCursor: string };
    (deps.sleeper as FakeSleeper).onSleep = async (_ms, count) => {
      if (count === 2) {
        store.messages.push(
          makeMessage({ id: "m_wake", toSessionId: "current", body: "wake" }),
        );
      }
    };

    const result = await callMcpTool(
      "wait_messages",
      { cursor: anchor.nextCursor },
      { ...ctx, deps },
    );
    expect(result.isError).toBeUndefined();
    const page = parsed(result) as {
      messages: { id: string }[];
      timedOut: boolean;
      hasMore: boolean;
    };
    expect(page.messages.map((m) => m.id)).toEqual(["m_wake"]);
    expect(page.timedOut).toBe(false);
    expect(page.hasMore).toBe(false);
  });

  test("wait_messages timeout is a successful empty page, not an error", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    const deps = withCurrentSession(store, current);

    const anchor = parsed(
      await callMcpTool(
        "list_messages",
        { filter: { inbox: true } },
        { ...ctx, deps },
      ),
    ) as { nextCursor: string };

    const result = await callMcpTool(
      "wait_messages",
      { cursor: anchor.nextCursor, timeoutMs: 2_000 },
      { ...ctx, deps },
    );
    expect(result.isError).toBeUndefined();
    const page = parsed(result) as {
      messages: unknown[];
      nextCursor: string;
      hasMore: boolean;
      timedOut: boolean;
    };
    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.timedOut).toBe(true);
    expect(page.nextCursor).toBe(anchor.nextCursor);
  });

  test("wait_messages without a cursor is an invalid_input tool error", async () => {
    const store = new FakeStore();
    const deps = withCurrentSession(store, makeSession({ id: "current" }));

    const result = await callMcpTool("wait_messages", {}, { ...ctx, deps });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("invalid_input");
  });

  test("close_session force records a stale live Session closed when mux close fails", async () => {
    const store = new FakeStore();
    const current = makeSession({ id: "current" });
    store.sessions.push(
      makeSession({
        id: "s_stale",
        status: "running",
        muxRef: {
          pane_id: "pane-1",
          herdr_session: "asem",
          herdr_workspace_id: "missing-workspace",
        },
      }),
    );
    const deps = makeOpsDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: current.id,
        token: CURRENT_TOKEN,
        scope,
      }),
      templateRunner: new FakeTemplateRunner({
        commands: [{ exitCode: 1, stderr: "workspace not found" }],
      }),
    });
    store.sessions.push(current);

    const result = await callMcpTool(
      "close_session",
      { id: "s_stale", force: true },
      { ...ctx, deps },
    );

    expect(result.isError).toBeUndefined();
    const session = store.sessions.find((s) => s.id === "s_stale");
    expect(session?.status).toBe("closed");
    expect(session?.closedAt).not.toBeNull();
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

describe("MCP profile tools", () => {
  test("list_profiles delegates to the same ops handler as a direct call", async () => {
    const deps = makeOpsDeps();
    const mcp = await callMcpTool("list_profiles", {}, { ...ctx, deps });
    const direct = await listProfiles(deps, {}, { ...ctx, origin: "agent" });

    expect(mcp.isError).toBeUndefined();
    expect(parsed(mcp)).toEqual(direct.ok ? direct.value : direct.error);
  });

  test("get_profile returns a builtin profile by id", async () => {
    const deps = makeOpsDeps();
    const result = await callMcpTool(
      "get_profile",
      { id: "reviewer" },
      { ...ctx, deps },
    );
    expect(result.isError).toBeUndefined();
    expect(parsed(result)).toMatchObject({
      profile: { id: "reviewer", source: "builtin" },
    });
  });

  test("get_profile with an unknown id is an error result", async () => {
    const deps = makeOpsDeps();
    const result = await callMcpTool(
      "get_profile",
      { id: "nope" },
      { ...ctx, deps },
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("invalid_input");
  });
});
