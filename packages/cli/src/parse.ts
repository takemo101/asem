/**
 * CLI argument parsing for the `asem` binary.
 *
 * This is the "parse, don't merely check" boundary (implementation principle 1):
 * raw `argv` is turned into a typed {@link CliCommand} carrying the operation
 * inputs, or a structured `invalid_input` {@link OperationError}. Domain-value
 * validation (status enums, mux-ref shape) is deferred to the `@asem/core`
 * schemas the operations parse, so the CLI never duplicates that semantics.
 */
import {
  operationError,
  type MessageListFilter,
  type OperationError,
  type SessionListFilter,
} from "@asem/core";

/** A successfully parsed command plus its typed operation inputs. */
export type CliCommand =
  | { type: "init"; workspaceId: string }
  | {
      type: "init-session";
      name: string;
      agent?: string;
      mux?: string;
      muxRef: Record<string, unknown>;
      parentSessionId?: string | null;
      json: boolean;
    }
  | {
      type: "session-list";
      filter?: SessionListFilter;
      refresh: boolean;
      json: boolean;
    }
  | { type: "session-get"; id: string; refresh: boolean; json: boolean }
  | { type: "session-attach"; id: string; json: boolean }
  | { type: "message-list"; filter?: MessageListFilter; json: boolean }
  | {
      type: "message-send";
      toSessionId: string;
      body: string;
      json: boolean;
    }
  | { type: "report-parent"; body: string; json: boolean };

/** Outcome of parsing `argv`: a command, a help request, or a structured error. */
export type ParseResult =
  | { kind: "command"; command: CliCommand }
  | { kind: "help"; topic?: string }
  | { kind: "error"; error: OperationError };

function invalid(message: string, details?: Record<string, unknown>): ParseResult {
  return { kind: "error", error: operationError("invalid_input", message, details) };
}

interface FlagSpec {
  /** Flags that take no value (presence => true). */
  booleans: readonly string[];
  /** Flags that consume the next token (or `--flag=value`). */
  values: readonly string[];
}

interface Flags {
  values: Map<string, string>;
  booleans: Set<string>;
  positionals: string[];
}

/** Internal parse outcome: a typed value or a structured error. */
type Parsed<T> = { ok: true; value: T } | { ok: false; error: OperationError };

/**
 * Split `args` into typed flags + positionals against a per-command spec.
 * Unknown options and missing values are reported as `invalid_input` so every
 * surface error has a stable code (implementation principle 11).
 */
function parseFlags(args: string[], spec: FlagSpec): Parsed<Flags> {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (spec.booleans.includes(name)) {
      if (eq >= 0) {
        return fail(`option --${name} takes no value`);
      }
      booleans.add(name);
      continue;
    }
    if (spec.values.includes(name)) {
      let value: string;
      if (eq >= 0) {
        value = arg.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next === undefined) {
          return fail(`option --${name} requires a value`);
        }
        value = next;
        i += 1;
      }
      values.set(name, value);
      continue;
    }
    return fail(`unknown option --${name}`);
  }

  return { ok: true, value: { values, booleans, positionals } };
}

function fail<T = never>(
  message: string,
  details?: Record<string, unknown>,
): Parsed<T> {
  return { ok: false, error: operationError("invalid_input", message, details) };
}

// --- per-command parsers ---------------------------------------------------

function parseInit(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: [], values: ["workspace", "id"] });
  if (!flags.ok) return { kind: "error", error: flags.error };

  const workspaceId =
    flags.value.values.get("workspace") ??
    flags.value.values.get("id") ??
    flags.value.positionals[0];
  if (workspaceId === undefined || workspaceId.length === 0) {
    return invalid("workspace id is required (use `asem init --workspace <id>`)");
  }
  if (flags.value.positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: flags.value.positionals.slice(1),
    });
  }
  return { kind: "command", command: { type: "init", workspaceId } };
}

function parseMuxRef(raw: string): Parsed<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("--mux-ref must be valid JSON (e.g. `--mux-ref '{\"pane\":\"p1\"}'`)");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("--mux-ref must be a JSON object");
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function parseInitSession(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["root", "json"],
    values: ["name", "agent", "mux", "mux-ref", "parent"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans } = flags.value;

  const name = values.get("name");
  if (name === undefined || name.length === 0) {
    return invalid("session name is required (use `--name <name>`)");
  }

  const muxRefRaw = values.get("mux-ref");
  if (muxRefRaw === undefined) {
    return invalid(
      "a mux reference is required so the Session is deliverable (use `--mux-ref '<json>'`)",
    );
  }
  const muxRef = parseMuxRef(muxRefRaw);
  if (!muxRef.ok) return { kind: "error", error: muxRef.error };

  const isRoot = booleans.has("root");
  const parent = values.get("parent");
  if (isRoot && parent !== undefined) {
    return invalid("--root and --parent are mutually exclusive");
  }
  const agent = values.get("agent");
  const mux = values.get("mux");

  const command: CliCommand = {
    type: "init-session",
    name,
    json: booleans.has("json"),
    muxRef: muxRef.value,
    ...(agent !== undefined ? { agent } : {}),
    ...(mux !== undefined ? { mux } : {}),
    ...(isRoot ? { parentSessionId: null } : {}),
    ...(parent !== undefined ? { parentSessionId: parent } : {}),
  };
  return { kind: "command", command };
}

function parseSessionList(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["refresh", "json"],
    values: ["status", "parent"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans } = flags.value;

  const status = values.get("status");
  const parent = values.get("parent");
  let filter: SessionListFilter | undefined;
  if (status !== undefined || parent !== undefined) {
    filter = {
      // `status` is passed through verbatim; the operation's schema validates
      // the enum so the CLI does not duplicate the domain's status vocabulary.
      ...(status !== undefined ? { status: status as SessionListFilter["status"] } : {}),
      ...(parent !== undefined ? { parentSessionId: parent } : {}),
    };
  }
  return {
    kind: "command",
    command: {
      type: "session-list",
      refresh: booleans.has("refresh"),
      json: booleans.has("json"),
      ...(filter !== undefined ? { filter } : {}),
    },
  };
}

function parseSessionGet(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["refresh", "json"],
    values: [],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;

  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    return invalid("session id is required (use `asem session get <id>`)");
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  return {
    kind: "command",
    command: {
      type: "session-get",
      id,
      refresh: booleans.has("refresh"),
      json: booleans.has("json"),
    },
  };
}

function parseSessionAttach(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;

  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    return invalid("session id is required (use `asem session attach <id>`)");
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  return {
    kind: "command",
    command: { type: "session-attach", id, json: booleans.has("json") },
  };
}

function parseSession(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing session subcommand (list | get | attach)");
    case "list":
      return parseSessionList(rest);
    case "get":
      return parseSessionGet(rest);
    case "attach":
      return parseSessionAttach(rest);
    default:
      return invalid(`unknown session subcommand: ${sub}`, {
        expected: ["list", "get", "attach"],
      });
  }
}

function parseMessageList(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["inbox", "undelivered", "json"],
    values: ["to"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans } = flags.value;

  const to = values.get("to");
  const inbox = booleans.has("inbox");
  const undelivered = booleans.has("undelivered");
  let filter: MessageListFilter | undefined;
  if (to !== undefined || inbox || undelivered) {
    filter = {
      ...(to !== undefined ? { toSessionId: to } : {}),
      ...(inbox ? { inbox: true } : {}),
      ...(undelivered ? { undelivered: true } : {}),
    };
  }
  return {
    kind: "command",
    command: {
      type: "message-list",
      json: booleans.has("json"),
      ...(filter !== undefined ? { filter } : {}),
    },
  };
}

function parseMessageSend(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["json"],
    values: ["to", "body"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans, positionals } = flags.value;

  // The target accepts a positional id or `--to <id>`, mirroring `message list`.
  const to = values.get("to") ?? positionals[0];
  if (to === undefined || to.length === 0) {
    return invalid(
      "target session id is required (use `asem message send <session-id> --body <text>`)",
    );
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  const body = values.get("body");
  if (body === undefined) {
    return invalid("message body is required (use `--body <text>`)");
  }
  return {
    kind: "command",
    command: {
      type: "message-send",
      toSessionId: to,
      body,
      json: booleans.has("json"),
    },
  };
}

function parseMessage(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing message subcommand (list | send)");
    case "list":
      return parseMessageList(rest);
    case "send":
      return parseMessageSend(rest);
    default:
      return invalid(`unknown message subcommand: ${sub}`, {
        expected: ["list", "send"],
      });
  }
}

function parseReportParent(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: ["body"] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans } = flags.value;

  const body = values.get("body");
  if (body === undefined) {
    return invalid("report body is required (use `asem report parent --body <text>`)");
  }
  return {
    kind: "command",
    command: { type: "report-parent", body, json: booleans.has("json") },
  };
}

function parseReport(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing report subcommand (parent)");
    case "parent":
      return parseReportParent(rest);
    default:
      return invalid(`unknown report subcommand: ${sub}`, {
        expected: ["parent"],
      });
  }
}

/** True when `arg` is a help request token. */
function isHelpFlag(arg: string | undefined): boolean {
  return arg === "--help" || arg === "-h" || arg === "help";
}

/** Parse `argv` (already stripped of node/script) into a {@link ParseResult}. */
export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;

  if (command === undefined || isHelpFlag(command)) {
    return { kind: "help" };
  }
  // `asem <group> --help` / `asem <group> help` shows group help.
  if (rest.length > 0 && isHelpFlag(rest[rest.length - 1])) {
    return { kind: "help", topic: command };
  }

  switch (command) {
    case "init":
      return parseInit(rest);
    case "init-session":
      return parseInitSession(rest);
    case "session":
      return parseSession(rest);
    case "message":
      return parseMessage(rest);
    case "report":
      return parseReport(rest);
    default:
      return invalid(`unknown command: ${command}`, {
        expected: ["init", "init-session", "session", "message", "report"],
      });
  }
}
