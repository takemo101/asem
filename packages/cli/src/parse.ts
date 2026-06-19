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
  type MessageListFilter,
  type OperationError,
  operationError,
  type SessionListFilter,
} from "@asem/core";

/** A successfully parsed command plus its typed operation inputs. */
export type CliCommand =
  | {
      type: "init";
      workspaceId?: string;
      agent?: string;
      mux?: string;
      interactive: boolean;
    }
  | { type: "doctor"; json: boolean }
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
      type: "session-create";
      name: string;
      prompt: string;
      agent?: string;
      mux?: string;
      model?: string;
      profile?: string;
      cwd?: string;
      repo?: string;
      parentSessionId?: string;
      root?: boolean;
      json: boolean;
    }
  | { type: "workspace-repo-list"; json: boolean }
  | { type: "profile-list"; json: boolean }
  | { type: "profile-get"; id: string; json: boolean }
  | {
      type: "session-list";
      filter?: SessionListFilter;
      refresh: boolean;
      json: boolean;
    }
  | { type: "session-get"; id: string; refresh: boolean; json: boolean }
  | { type: "session-attach"; id: string; json: boolean }
  | { type: "session-close"; id: string; force: boolean; json: boolean }
  | { type: "session-delete"; id: string; force: boolean; json: boolean }
  | { type: "message-list"; filter?: MessageListFilter; json: boolean }
  | {
      type: "message-wait";
      toSessionId: string;
      fromSessionId?: string;
      kind?: "message" | "report";
      timeoutMs: number;
      pollMs: number;
      json: boolean;
    }
  | {
      type: "message-send";
      toSessionId: string;
      body: string;
      json: boolean;
    }
  | { type: "report-parent"; body: string; json: boolean }
  | { type: "mcp" }
  | { type: "mcp-add"; target: string; global: boolean }
  | { type: "skills-add"; target: string; global: boolean };

/** Outcome of parsing `argv`: a command, a help request, or a structured error. */
export type ParseResult =
  | { kind: "command"; command: CliCommand }
  | { kind: "help"; topic?: string }
  | { kind: "version" }
  | { kind: "error"; error: OperationError };

function invalid(
  message: string,
  details?: Record<string, unknown>,
): ParseResult {
  return {
    kind: "error",
    error: operationError("invalid_input", message, details),
  };
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
  return {
    ok: false,
    error: operationError("invalid_input", message, details),
  };
}

// --- per-command parsers ---------------------------------------------------

function parseInit(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["interactive"],
    values: ["workspace", "id", "agent", "mux"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };

  const workspaceId =
    flags.value.values.get("workspace") ??
    flags.value.values.get("id") ??
    flags.value.positionals[0];
  const interactive = flags.value.booleans.has("interactive");
  if (workspaceId !== undefined && workspaceId.length === 0) {
    return invalid(
      "workspace id is required (use `asem init --workspace <id>`)",
    );
  }
  if (flags.value.positionals.length > (workspaceId === undefined ? 0 : 1)) {
    return invalid("unexpected extra arguments", {
      extra: flags.value.positionals.slice(1),
    });
  }

  const agent = flags.value.values.get("agent");
  const mux = flags.value.values.get("mux");
  if (!interactive && (agent === undefined) !== (mux === undefined)) {
    return invalid("--agent and --mux must be provided together");
  }
  const command: CliCommand = {
    type: "init",
    interactive,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(mux !== undefined ? { mux } : {}),
  };
  return { kind: "command", command };
}

function parseMuxRef(raw: string): Parsed<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(
      '--mux-ref must be valid JSON (e.g. `--mux-ref \'{"pane":"p1"}\'`)',
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("--mux-ref must be a JSON object");
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function parseDoctor(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;
  if (positionals.length > 0) {
    return invalid("unexpected extra arguments", { extra: positionals });
  }
  return {
    kind: "command",
    command: { type: "doctor", json: booleans.has("json") },
  };
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

/**
 * `asem session create <name> --prompt <text> [--agent <a>] [--mux <m>]
 * [--cwd <dir>] [--root|--parent <id>] [--json]`.
 *
 * This is a pure surface projection over the shared `create_session` operation:
 * it maps flags to the operation input and renders the result. Parent behavior
 * (`--root` vs `--parent <id>` vs the current-Session fallback) is decided by
 * the operation's truth table, so the CLI only forwards the chosen flags and
 * rejects the one combination that is meaningless here — `--root` with
 * `--parent` — mirroring `init-session`.
 */
function parseSessionCreate(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["root", "json"],
    values: [
      "name",
      "prompt",
      "agent",
      "mux",
      "model",
      "profile",
      "cwd",
      "repo",
      "parent",
    ],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans, positionals } = flags.value;

  // The name accepts the documented positional or `--name`, mirroring
  // `message send`'s positional/flag duality.
  const name = values.get("name") ?? positionals[0];
  if (name === undefined || name.length === 0) {
    return invalid(
      "session name is required (use `asem session create <name> --prompt <text>`)",
    );
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }

  const prompt = values.get("prompt");
  if (prompt === undefined) {
    return invalid("a prompt is required (use `--prompt <text>`)");
  }

  const isRoot = booleans.has("root");
  const parent = values.get("parent");
  if (isRoot && parent !== undefined) {
    return invalid("--root and --parent are mutually exclusive");
  }
  const agent = values.get("agent");
  const mux = values.get("mux");
  const model = values.get("model");
  const profile = values.get("profile");
  const cwd = values.get("cwd");
  const repo = values.get("repo");
  // `--repo <alias>` and `--cwd <dir>` both choose the effective create cwd, so
  // accepting both would be ambiguous (design "Repo alias rules").
  if (repo !== undefined && cwd !== undefined) {
    return invalid("--repo and --cwd are mutually exclusive");
  }

  const command: CliCommand = {
    type: "session-create",
    name,
    prompt,
    json: booleans.has("json"),
    ...(agent !== undefined ? { agent } : {}),
    ...(mux !== undefined ? { mux } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(repo !== undefined ? { repo } : {}),
    ...(parent !== undefined ? { parentSessionId: parent } : {}),
    ...(isRoot ? { root: true } : {}),
  };
  return { kind: "command", command };
}

/**
 * `asem workspace repo list [--json]`. Lists the Repo Aliases declared in the
 * discovered `.asem.yaml` and each alias's path status. CLI-only convenience; it
 * reads config and the filesystem, never Session state.
 */
function parseWorkspaceRepoList(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;
  if (positionals.length > 0) {
    return invalid("unexpected extra arguments", { extra: positionals });
  }
  return {
    kind: "command",
    command: { type: "workspace-repo-list", json: booleans.has("json") },
  };
}

function parseWorkspaceRepo(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing workspace repo subcommand (list)");
    case "list":
      return parseWorkspaceRepoList(rest);
    default:
      return invalid(`unknown workspace repo subcommand: ${sub}`, {
        expected: ["list"],
      });
  }
}

function parseWorkspace(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing workspace subcommand (repo)");
    case "repo":
      return parseWorkspaceRepo(rest);
    default:
      return invalid(`unknown workspace subcommand: ${sub}`, {
        expected: ["repo"],
      });
  }
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
      ...(status !== undefined
        ? { status: status as SessionListFilter["status"] }
        : {}),
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

/** `asem session close <id> [--force] [--json]`. */
function parseSessionClose(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["force", "json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;

  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    return invalid("session id is required (use `asem session close <id>`)");
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  return {
    kind: "command",
    command: {
      type: "session-close",
      id,
      force: booleans.has("force"),
      json: booleans.has("json"),
    },
  };
}

/**
 * `asem session delete <id> [--force|--yes] [--json]`. The destructive
 * confirmation is mapped from `--force`/`--yes` here at the surface; whether the
 * delete may actually proceed is the operation's call (semantics live in ops).
 */
function parseSessionDelete(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["force", "yes", "json"],
    values: [],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;

  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    return invalid("session id is required (use `asem session delete <id>`)");
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  return {
    kind: "command",
    command: {
      type: "session-delete",
      id,
      force: booleans.has("force") || booleans.has("yes"),
      json: booleans.has("json"),
    },
  };
}

function parseSession(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid(
        "missing session subcommand (create | list | get | attach | close | delete)",
      );
    case "create":
      return parseSessionCreate(rest);
    case "list":
      return parseSessionList(rest);
    case "get":
      return parseSessionGet(rest);
    case "attach":
      return parseSessionAttach(rest);
    case "close":
      return parseSessionClose(rest);
    case "delete":
      return parseSessionDelete(rest);
    default:
      return invalid(`unknown session subcommand: ${sub}`, {
        expected: ["create", "list", "get", "attach", "close", "delete"],
      });
  }
}

/** `asem profile list [--json]`. */
function parseProfileList(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;
  if (positionals.length > 0) {
    return invalid("unexpected extra arguments", { extra: positionals });
  }
  return {
    kind: "command",
    command: { type: "profile-list", json: booleans.has("json") },
  };
}

/** `asem profile get <id> [--json]`. */
function parseProfileGet(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { positionals, booleans } = flags.value;

  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    return invalid("profile id is required (use `asem profile get <id>`)");
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }
  return {
    kind: "command",
    command: { type: "profile-get", id, json: booleans.has("json") },
  };
}

function parseProfile(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return invalid("missing profile subcommand (list | get)");
    case "list":
      return parseProfileList(rest);
    case "get":
      return parseProfileGet(rest);
    default:
      return invalid(`unknown profile subcommand: ${sub}`, {
        expected: ["list", "get"],
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

function parsePositiveInt(
  raw: string | undefined,
  name: string,
): Parsed<number> {
  if (raw === undefined) return { ok: true, value: 0 };
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`option --${name} must be a positive integer`);
  }
  return { ok: true, value };
}

function parseMessageWait(args: string[]): ParseResult {
  const flags = parseFlags(args, {
    booleans: ["json"],
    values: ["to", "from", "kind", "timeout-ms", "poll-ms"],
  });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans, positionals } = flags.value;

  const to = values.get("to") ?? positionals[0];
  if (to === undefined || to.length === 0) {
    return invalid(
      "target session id is required (use `asem message wait --to <session-id>`)",
    );
  }
  if (positionals.length > 1) {
    return invalid("unexpected extra arguments", {
      extra: positionals.slice(1),
    });
  }

  const timeout = parsePositiveInt(values.get("timeout-ms"), "timeout-ms");
  if (!timeout.ok) return { kind: "error", error: timeout.error };
  const poll = parsePositiveInt(values.get("poll-ms"), "poll-ms");
  if (!poll.ok) return { kind: "error", error: poll.error };

  const kindValue = values.get("kind");
  if (
    kindValue !== undefined &&
    kindValue !== "message" &&
    kindValue !== "report"
  ) {
    return invalid("option --kind must be message or report");
  }

  const fromSessionId = values.get("from");
  return {
    kind: "command",
    command: {
      type: "message-wait",
      toSessionId: to,
      timeoutMs: timeout.value === 0 ? 600_000 : timeout.value,
      pollMs: poll.value === 0 ? 1_000 : poll.value,
      json: booleans.has("json"),
      ...(fromSessionId !== undefined ? { fromSessionId } : {}),
      ...(kindValue !== undefined ? { kind: kindValue } : {}),
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
      return invalid("missing message subcommand (list | wait | send)");
    case "list":
      return parseMessageList(rest);
    case "wait":
      return parseMessageWait(rest);
    case "send":
      return parseMessageSend(rest);
    default:
      return invalid(`unknown message subcommand: ${sub}`, {
        expected: ["list", "wait", "send"],
      });
  }
}

function parseReportParent(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: ["body"] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans } = flags.value;

  const body = values.get("body");
  if (body === undefined) {
    return invalid(
      "report body is required (use `asem report parent --body <text>`)",
    );
  }
  return {
    kind: "command",
    command: { type: "report-parent", body, json: booleans.has("json") },
  };
}

/**
 * Shared parser for `mcp add` / `skills add` Integration Target setup commands.
 *
 * `--for <target>` names the Integration Target (it avoids `--agent`, which
 * already means the Session Agent in `session create`). Scope defaults to global;
 * `--no-global` requests workspace-local setup, which the installer rejects when
 * the target does not support it. Target validity is the installer's call, so the
 * surface forwards the raw `--for` value verbatim.
 */
function parseIntegrationAdd(
  kind: "mcp-add" | "skills-add",
  args: string[],
): ParseResult {
  const flags = parseFlags(args, { booleans: ["no-global"], values: ["for"] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const { values, booleans, positionals } = flags.value;

  const group = kind === "mcp-add" ? "mcp" : "skills";
  const target = values.get("for");
  if (target === undefined || target.length === 0) {
    return invalid(`${group} add requires --for <target>`);
  }
  if (positionals.length > 0) {
    return invalid("unexpected extra arguments", { extra: positionals });
  }
  return {
    kind: "command",
    command: { type: kind, target, global: !booleans.has("no-global") },
  };
}

/**
 * `asem mcp` starts the stdio server (mapped to `{ type: "mcp" }`); `asem mcp
 * add` installs an MCP registration into an Integration Target. The binary
 * intercepts bare `mcp` before dispatch, so this branch mainly serves `mcp add`
 * and keeps the command surface complete and testable.
 */
function parseMcp(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  if (sub === undefined) return { kind: "command", command: { type: "mcp" } };
  if (sub === "add") return parseIntegrationAdd("mcp-add", rest);
  return invalid(`unknown mcp subcommand: ${sub}`, { expected: ["add"] });
}

/** `asem skills add --for <target>` installs the asem Skill into a target. */
function parseSkills(args: string[]): ParseResult {
  const [sub, ...rest] = args;
  if (sub === undefined) return invalid("missing skills subcommand (add)");
  if (sub === "add") return parseIntegrationAdd("skills-add", rest);
  return invalid(`unknown skills subcommand: ${sub}`, { expected: ["add"] });
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

function isVersionFlag(arg: string | undefined): boolean {
  return arg === "--version" || arg === "-v";
}

const HELP_SUBCOMMANDS: Record<string, readonly string[]> = {
  session: ["create", "list", "get", "attach", "close", "delete"],
  workspace: ["repo"],
  profile: ["list", "get"],
  message: ["list", "wait", "send"],
  report: ["parent"],
  mcp: ["add"],
  skills: ["add"],
};

function helpResult(command: string, rest: readonly string[]): ParseResult {
  const directCommands = ["doctor", "init", "init-session", "tui"];
  if (directCommands.includes(command)) {
    const first = rest[0];
    if (first !== undefined && !first.startsWith("-") && !isHelpFlag(first)) {
      return invalid(`unexpected argument for ${command}: ${first}`);
    }
    return { kind: "help", topic: command };
  }

  const subcommands = HELP_SUBCOMMANDS[command];
  if (subcommands === undefined) {
    return invalid(`unknown command: ${command}`, {
      expected: [
        "doctor",
        "init",
        "init-session",
        "session",
        "workspace",
        "profile",
        "message",
        "report",
        "mcp",
        "skills",
      ],
    });
  }

  const sub = rest[0];
  if (sub === undefined || sub.startsWith("-") || isHelpFlag(sub)) {
    return { kind: "help", topic: command };
  }
  if (!subcommands.includes(sub)) {
    return invalid(`unknown ${command} subcommand: ${sub}`, {
      expected: [...subcommands],
    });
  }
  return { kind: "help", topic: `${command} ${sub}` };
}

/** Parse `argv` (already stripped of node/script) into a {@link ParseResult}. */
export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;

  if (command === undefined || isHelpFlag(command)) {
    return { kind: "help" };
  }
  if (isVersionFlag(command)) {
    if (rest.length > 0) {
      return invalid("version accepts no extra arguments", { extra: rest });
    }
    return { kind: "version" };
  }
  // `asem <command> --help` shows focused help only for known commands and
  // subcommands; unknown command paths still report `invalid_input` instead of
  // being masked by the root help page.
  if (rest.length > 0 && isHelpFlag(rest[rest.length - 1])) {
    return helpResult(command, rest);
  }

  switch (command) {
    case "init":
      return parseInit(rest);
    case "init-session":
      return parseInitSession(rest);
    case "doctor":
      return parseDoctor(rest);
    case "session":
      return parseSession(rest);
    case "workspace":
      return parseWorkspace(rest);
    case "profile":
      return parseProfile(rest);
    case "message":
      return parseMessage(rest);
    case "report":
      return parseReport(rest);
    case "mcp":
      return parseMcp(rest);
    case "skills":
      return parseSkills(rest);
    default:
      return invalid(`unknown command: ${command}`, {
        expected: [
          "doctor",
          "init",
          "init-session",
          "session",
          "workspace",
          "profile",
          "message",
          "report",
          "mcp",
          "skills",
        ],
      });
  }
}
