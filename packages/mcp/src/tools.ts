/**
 * MCP tool projection over shared `@asem/ops` handlers.
 *
 * This module is intentionally a surface adapter only: it parses MCP tool
 * arguments, delegates to the corresponding operation, and wraps the operation
 * result in MCP-style content. It owns no Session semantics, scope rules,
 * delivery behavior, or destructive-operation policy.
 */
import {
  closeSessionInputSchema,
  createSessionInputSchema,
  deleteSessionInputSchema,
  getProfileInputSchema,
  getSessionInputSchema,
  initSessionInputSchema,
  listMessagesInputSchema,
  listProfilesInputSchema,
  listSessionsInputSchema,
  type OperationError,
  type OperationResult,
  reportParentInputSchema,
  sendMessageInputSchema,
} from "@asem/core";
import {
  closeSession,
  createSession,
  deleteSession,
  getProfile,
  getSession,
  initSession,
  listMessages,
  listProfiles,
  listSessions,
  type OpsDeps,
  reportParent,
  sendMessage,
} from "@asem/ops";

interface ParseSchema<T> {
  safeParse(value: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: Array<{ path: Array<string | number>; message: string }>;
        };
      };
}

export interface McpContext {
  cwd: string;
  deps: OpsDeps;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpToolContent[];
  isError?: boolean;
}

type ToolHandler = (
  args: unknown,
  context: McpContext,
) => Promise<McpToolResult>;

interface ToolSpec {
  definition: McpToolDefinition;
  handler: ToolHandler;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const stringSchema = { type: "string" };
const booleanSchema = { type: "boolean" };
const muxRefSchema = {
  type: "object",
  additionalProperties: true,
  description: "Multiplexer reference captured by the mux template.",
};

const sessionListFilterSchema = objectSchema({
  status: {
    type: "string",
    enum: ["starting", "running", "exited", "missing", "closed"],
  },
  parentSessionId: { anyOf: [{ type: "string" }, { type: "null" }] },
});

const messageListFilterSchema = objectSchema({
  toSessionId: stringSchema,
  inbox: booleanSchema,
  undelivered: booleanSchema,
});

const toolDefinitions = {
  init_session: {
    name: "init_session",
    description:
      "Register the current agent Session and return its token once.",
    inputSchema: objectSchema(
      {
        name: stringSchema,
        agent: stringSchema,
        mux: stringSchema,
        muxRef: muxRefSchema,
        parentSessionId: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      ["name", "muxRef"],
    ),
  },
  create_session: {
    name: "create_session",
    description:
      "Create and launch a child Session through configured templates.",
    inputSchema: objectSchema(
      {
        name: stringSchema,
        prompt: stringSchema,
        agent: stringSchema,
        mux: stringSchema,
        // Optional per-Session model; the shared createSessionInputSchema parses
        // and enforces the real contract (non-empty, Template-supported).
        model: stringSchema,
        // Optional Agent Profile id; the shared schema/op resolve and apply it.
        profile: stringSchema,
        cwd: stringSchema,
        parentSessionId: stringSchema,
        root: booleanSchema,
      },
      ["name", "prompt"],
    ),
  },
  list_profiles: {
    name: "list_profiles",
    description:
      "List Agent Profiles (project, user, builtin) available in scope.",
    inputSchema: objectSchema({}),
  },
  get_profile: {
    name: "get_profile",
    description: "Get one Agent Profile's metadata and full instructions.",
    inputSchema: objectSchema({ id: stringSchema }, ["id"]),
  },
  list_sessions: {
    name: "list_sessions",
    description: "List Sessions in the current effective scope.",
    inputSchema: objectSchema({ filter: sessionListFilterSchema }),
  },
  get_session: {
    name: "get_session",
    description: "Get one Session in the current effective scope.",
    inputSchema: objectSchema({ id: stringSchema }, ["id"]),
  },
  close_session: {
    name: "close_session",
    description:
      "Close a Session pane/process and record closed process state. force=true records a known-stale live Session closed even when mux close fails.",
    inputSchema: objectSchema({ id: stringSchema, force: booleanSchema }, [
      "id",
    ]),
  },
  delete_session: {
    name: "delete_session",
    description: "Delete a Session and related Messages. Requires force=true.",
    inputSchema: objectSchema({ id: stringSchema, force: booleanSchema }, [
      "id",
    ]),
  },
  send_message: {
    name: "send_message",
    description: "Send a durable Message to another Session in scope.",
    inputSchema: objectSchema(
      { toSessionId: stringSchema, body: stringSchema, kind: stringSchema },
      ["toSessionId", "body"],
    ),
  },
  report_parent: {
    name: "report_parent",
    description: "Send a report Message to the current Session's parent.",
    inputSchema: objectSchema({ body: stringSchema }, ["body"]),
  },
  list_messages: {
    name: "list_messages",
    description: "List Message history in the current effective scope.",
    inputSchema: objectSchema({ filter: messageListFilterSchema }),
  },
} satisfies Record<string, McpToolDefinition>;

function jsonContent(value: unknown, isError = false): McpToolResult {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function sanitizeError(error: OperationError): OperationError {
  // Operation errors are structured and should already be redacted by ops. Keep
  // only the structured error payload and never include raw input arguments in
  // schema errors below, where token-like strings may be present.
  return error;
}

function operationResult<T>(result: OperationResult<T>): McpToolResult {
  if (!result.ok) {
    return jsonContent({ error: sanitizeError(result.error) }, true);
  }
  return jsonContent(result.value);
}

function parseInput<T>(
  schema: ParseSchema<T>,
  args: unknown,
): T | OperationError {
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return parsed.data;
  return {
    code: "invalid_input",
    message: "invalid MCP tool arguments",
    details: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    },
  };
}

async function parsed<T>(
  schema: ParseSchema<T>,
  args: unknown,
  run: (input: T) => Promise<McpToolResult>,
): Promise<McpToolResult> {
  const input = parseInput(schema, args);
  if ("code" in (input as object)) {
    return jsonContent({ error: input }, true);
  }
  return run(input as T);
}

const tools = {
  init_session: {
    definition: toolDefinitions.init_session,
    handler: (args, { cwd, deps }) =>
      parsed(initSessionInputSchema, args, async (input) =>
        operationResult(
          await initSession(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  create_session: {
    definition: toolDefinitions.create_session,
    handler: (args, { cwd, deps }) =>
      parsed(createSessionInputSchema, args, async (input) =>
        operationResult(
          await createSession(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  list_sessions: {
    definition: toolDefinitions.list_sessions,
    handler: (args, { cwd, deps }) =>
      parsed(listSessionsInputSchema, args, async (input) =>
        operationResult(
          await listSessions(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  list_profiles: {
    definition: toolDefinitions.list_profiles,
    handler: (args, { cwd, deps }) =>
      parsed(listProfilesInputSchema, args, async (input) =>
        operationResult(
          await listProfiles(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  get_profile: {
    definition: toolDefinitions.get_profile,
    handler: (args, { cwd, deps }) =>
      parsed(getProfileInputSchema, args, async (input) =>
        operationResult(
          await getProfile(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  get_session: {
    definition: toolDefinitions.get_session,
    handler: (args, { cwd, deps }) =>
      parsed(getSessionInputSchema, args, async (input) =>
        operationResult(
          await getSession(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  close_session: {
    definition: toolDefinitions.close_session,
    handler: (args, { cwd, deps }) =>
      parsed(closeSessionInputSchema, args, async (input) =>
        operationResult(
          await closeSession(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  delete_session: {
    definition: toolDefinitions.delete_session,
    handler: (args, { cwd, deps }) =>
      parsed(deleteSessionInputSchema, args, async (input) =>
        operationResult(
          await deleteSession(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  send_message: {
    definition: toolDefinitions.send_message,
    handler: (args, { cwd, deps }) =>
      parsed(sendMessageInputSchema, args, async (input) =>
        operationResult(
          await sendMessage(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  report_parent: {
    definition: toolDefinitions.report_parent,
    handler: (args, { cwd, deps }) =>
      parsed(reportParentInputSchema, args, async (input) =>
        operationResult(
          await reportParent(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
  list_messages: {
    definition: toolDefinitions.list_messages,
    handler: (args, { cwd, deps }) =>
      parsed(listMessagesInputSchema, args, async (input) =>
        operationResult(
          await listMessages(deps, input, { cwd, origin: "agent" }),
        ),
      ),
  },
} satisfies Record<string, ToolSpec>;

export function listMcpTools(): McpToolDefinition[] {
  return Object.values(tools).map((tool) => tool.definition);
}

export function hasMcpTool(name: string): boolean {
  return Object.hasOwn(tools, name);
}

export async function callMcpTool(
  name: string,
  args: unknown,
  context: McpContext,
): Promise<McpToolResult> {
  const tool = tools[name as keyof typeof tools];
  if (tool === undefined) {
    return jsonContent(
      {
        error: {
          code: "invalid_input",
          message: `unknown MCP tool: ${name}`,
        },
      },
      true,
    );
  }
  return tool.handler(args, context);
}
