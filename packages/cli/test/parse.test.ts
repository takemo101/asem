import { describe, expect, test } from "bun:test";
import { type CliCommand, parseArgs } from "../src/parse.ts";

/** Parse and assert success, returning the typed command. */
function command(argv: string[]): CliCommand {
  const result = parseArgs(argv);
  if (result.kind !== "command") {
    throw new Error(
      `expected command, got ${result.kind}: ${JSON.stringify(result)}`,
    );
  }
  return result.command;
}

/** Parse and assert an `invalid_input` error result. */
function errorCode(argv: string[]): string {
  const result = parseArgs(argv);
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("unreachable");
  return result.error.code;
}

describe("parseArgs help", () => {
  test("no args shows root help", () => {
    expect(parseArgs([]).kind).toBe("help");
  });

  test("--help and -h show help", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
    expect(parseArgs(["-h"]).kind).toBe("help");
  });

  test("group help carries the topic", () => {
    const result = parseArgs(["init-session", "--help"]);
    expect(result.kind).toBe("help");
    if (result.kind === "help") expect(result.topic).toBe("init-session");
  });

  /** Parse a help request and return its topic (undefined for root help). */
  function helpTopic(argv: string[]): string | undefined {
    const result = parseArgs(argv);
    expect(result.kind).toBe("help");
    if (result.kind !== "help") throw new Error("unreachable");
    return result.topic;
  }

  test("a bare group --help carries just the group as the topic", () => {
    expect(helpTopic(["session", "--help"])).toBe("session");
    expect(helpTopic(["message", "--help"])).toBe("message");
    expect(helpTopic(["report", "--help"])).toBe("report");
  });

  test("subcommand --help carries the `group subcommand` topic", () => {
    expect(helpTopic(["session", "create", "--help"])).toBe("session create");
    expect(helpTopic(["message", "wait", "--help"])).toBe("message wait");
    expect(helpTopic(["report", "parent", "--help"])).toBe("report parent");
  });

  test("tui and mcp --help carry their command as the topic", () => {
    expect(helpTopic(["tui", "--help"])).toBe("tui");
    expect(helpTopic(["mcp", "--help"])).toBe("mcp");
  });

  test("unknown command is invalid_input", () => {
    expect(errorCode(["frobnicate"])).toBe("invalid_input");
  });

  test("unknown command with --help is invalid_input", () => {
    expect(errorCode(["frobnicate", "--help"])).toBe("invalid_input");
  });

  test("unknown subcommand with --help is invalid_input", () => {
    expect(errorCode(["session", "frobnicate", "--help"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["message", "frobnicate", "--help"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["report", "frobnicate", "--help"])).toBe("invalid_input");
  });

  test("direct command help tolerates option-shaped context", () => {
    expect(helpTopic(["init", "--workspace", "ws", "--help"])).toBe("init");
    expect(helpTopic(["tui", "--scope", "workspace", "--help"])).toBe("tui");
  });

  test("an unknown option is still invalid_input, not masked as help", () => {
    expect(errorCode(["session", "list", "--bogus"])).toBe("invalid_input");
  });
});

describe("parseArgs init", () => {
  test("maps --workspace to workspaceId", () => {
    expect(command(["init", "--workspace", "ws-1"])).toEqual({
      type: "init",
      workspaceId: "ws-1",
      interactive: false,
    });
  });

  test("accepts a positional workspace id", () => {
    expect(command(["init", "ws-2"])).toEqual({
      type: "init",
      workspaceId: "ws-2",
      interactive: false,
    });
  });

  test("maps interactive init without requiring a workspace id", () => {
    expect(command(["init", "--interactive"])).toEqual({
      type: "init",
      interactive: true,
    });
  });

  test("maps non-interactive init template selections", () => {
    expect(
      command([
        "init",
        "--workspace",
        "ws-1",
        "--agent",
        "pi",
        "--mux",
        "tmux",
      ]),
    ).toEqual({
      type: "init",
      workspaceId: "ws-1",
      agent: "pi",
      mux: "tmux",
      interactive: false,
    });
  });

  test("non-interactive init can omit workspace so existing config can no-op", () => {
    expect(command(["init"])).toEqual({
      type: "init",
      interactive: false,
    });
  });

  test("non-interactive init requires agent and mux together", () => {
    expect(errorCode(["init", "--workspace", "ws", "--agent", "pi"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["init", "--workspace", "ws", "--mux", "tmux"])).toBe(
      "invalid_input",
    );
  });

  test("extra positionals are invalid_input", () => {
    expect(errorCode(["init", "ws", "extra"])).toBe("invalid_input");
  });
});

describe("parseArgs init-session", () => {
  test("maps name, mux-ref, agent, mux, parent", () => {
    const cmd = command([
      "init-session",
      "--name",
      "reviewer-1",
      "--mux-ref",
      '{"pane":"p1"}',
      "--agent",
      "codex",
      "--mux",
      "tmux",
      "--parent",
      "s_parent",
    ]);
    expect(cmd).toEqual({
      type: "init-session",
      name: "reviewer-1",
      muxRef: { pane: "p1" },
      agent: "codex",
      mux: "tmux",
      parentSessionId: "s_parent",
      json: false,
    });
  });

  test("--root sets a null parent", () => {
    const cmd = command([
      "init-session",
      "--name",
      "root-1",
      "--mux-ref",
      "{}",
      "--root",
    ]);
    expect(cmd).toMatchObject({ type: "init-session", parentSessionId: null });
  });

  test("--root and --parent are mutually exclusive", () => {
    expect(
      errorCode([
        "init-session",
        "--name",
        "x",
        "--mux-ref",
        "{}",
        "--root",
        "--parent",
        "p",
      ]),
    ).toBe("invalid_input");
  });

  test("missing name is invalid_input", () => {
    expect(errorCode(["init-session", "--mux-ref", "{}"])).toBe(
      "invalid_input",
    );
  });

  test("missing mux-ref is invalid_input", () => {
    expect(errorCode(["init-session", "--name", "x"])).toBe("invalid_input");
  });

  test("non-JSON mux-ref is invalid_input", () => {
    expect(
      errorCode(["init-session", "--name", "x", "--mux-ref", "nope"]),
    ).toBe("invalid_input");
  });

  test("array mux-ref is invalid_input (must be an object)", () => {
    expect(
      errorCode(["init-session", "--name", "x", "--mux-ref", "[1,2]"]),
    ).toBe("invalid_input");
  });
});

describe("parseArgs session create", () => {
  test("maps a positional name + --prompt and defaults json to false", () => {
    expect(
      command(["session", "create", "reviewer-1", "--prompt", "do it"]),
    ).toEqual({
      type: "session-create",
      name: "reviewer-1",
      prompt: "do it",
      json: false,
    });
  });

  test("maps optional --agent/--mux/--cwd and a positional name", () => {
    expect(
      command([
        "session",
        "create",
        "helper-1",
        "--prompt",
        "go",
        "--agent",
        "codex",
        "--mux",
        "tmux",
        "--cwd",
        "/repo/a/sub",
        "--json",
      ]),
    ).toEqual({
      type: "session-create",
      name: "helper-1",
      prompt: "go",
      agent: "codex",
      mux: "tmux",
      cwd: "/repo/a/sub",
      json: true,
    });
  });

  test("--root sets root=true", () => {
    expect(
      command(["session", "create", "root-1", "--prompt", "x", "--root"]),
    ).toMatchObject({ type: "session-create", root: true });
  });

  test("--parent <id> maps to parentSessionId", () => {
    expect(
      command([
        "session",
        "create",
        "child-1",
        "--prompt",
        "x",
        "--parent",
        "s_parent",
      ]),
    ).toMatchObject({ type: "session-create", parentSessionId: "s_parent" });
  });

  test("--root and --parent are mutually exclusive", () => {
    expect(
      errorCode([
        "session",
        "create",
        "x",
        "--prompt",
        "p",
        "--root",
        "--parent",
        "s_p",
      ]),
    ).toBe("invalid_input");
  });

  test("--model maps to model", () => {
    expect(
      command([
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--model",
        "sonnet",
      ]),
    ).toMatchObject({ type: "session-create", model: "sonnet" });
  });

  test("omitting --model leaves model unset", () => {
    expect(
      command(["session", "create", "reviewer-1", "--prompt", "do it"]),
    ).not.toHaveProperty("model");
  });

  test("--model with no value is invalid_input", () => {
    expect(
      errorCode(["session", "create", "x", "--prompt", "p", "--model"]),
    ).toBe("invalid_input");
  });

  test("missing name is invalid_input", () => {
    expect(errorCode(["session", "create", "--prompt", "p"])).toBe(
      "invalid_input",
    );
  });

  test("missing prompt is invalid_input", () => {
    expect(errorCode(["session", "create", "reviewer-1"])).toBe(
      "invalid_input",
    );
  });

  test("extra positionals are invalid_input", () => {
    expect(
      errorCode(["session", "create", "n", "extra", "--prompt", "p"]),
    ).toBe("invalid_input");
  });
});

describe("parseArgs session", () => {
  test("session list maps status/parent into a filter and flags", () => {
    const cmd = command([
      "session",
      "list",
      "--status",
      "running",
      "--parent",
      "s_p",
      "--refresh",
      "--json",
    ]);
    expect(cmd).toEqual({
      type: "session-list",
      filter: { status: "running", parentSessionId: "s_p" },
      refresh: true,
      json: true,
    });
  });

  test("session list without filters omits filter", () => {
    expect(command(["session", "list"])).toEqual({
      type: "session-list",
      refresh: false,
      json: false,
    });
  });

  test("session get requires an id", () => {
    expect(errorCode(["session", "get"])).toBe("invalid_input");
  });

  test("session get maps id + refresh", () => {
    expect(command(["session", "get", "s_1", "--refresh"])).toEqual({
      type: "session-get",
      id: "s_1",
      refresh: true,
      json: false,
    });
  });

  test("session attach maps id", () => {
    expect(command(["session", "attach", "s_1"])).toEqual({
      type: "session-attach",
      id: "s_1",
      json: false,
    });
  });

  test("session close maps id", () => {
    expect(command(["session", "close", "s_1"])).toEqual({
      type: "session-close",
      id: "s_1",
      json: false,
    });
  });

  test("session close requires an id", () => {
    expect(errorCode(["session", "close"])).toBe("invalid_input");
  });

  test("session delete maps id and force (--force or --yes)", () => {
    expect(command(["session", "delete", "s_1", "--force"])).toEqual({
      type: "session-delete",
      id: "s_1",
      force: true,
      json: false,
    });
    expect(command(["session", "delete", "s_1", "--yes"])).toMatchObject({
      type: "session-delete",
      force: true,
    });
  });

  test("session delete defaults force to false (semantics enforced by ops)", () => {
    expect(command(["session", "delete", "s_1"])).toEqual({
      type: "session-delete",
      id: "s_1",
      force: false,
      json: false,
    });
  });

  test("session delete requires an id", () => {
    expect(errorCode(["session", "delete"])).toBe("invalid_input");
  });

  test("unknown session subcommand is invalid_input", () => {
    expect(errorCode(["session", "destroy", "s_1"])).toBe("invalid_input");
  });

  test("unknown option is invalid_input", () => {
    expect(errorCode(["session", "list", "--bogus"])).toBe("invalid_input");
  });
});

describe("parseArgs message", () => {
  test("message list maps to/inbox/undelivered", () => {
    expect(
      command(["message", "list", "--to", "s_1", "--inbox", "--undelivered"]),
    ).toEqual({
      type: "message-list",
      filter: { toSessionId: "s_1", inbox: true, undelivered: true },
      json: false,
    });
  });

  test("message list without flags omits filter", () => {
    expect(command(["message", "list"])).toEqual({
      type: "message-list",
      json: false,
    });
  });

  test("a value flag without a value is invalid_input", () => {
    expect(errorCode(["message", "list", "--to"])).toBe("invalid_input");
  });
});

describe("parseArgs message wait", () => {
  test("maps filters, timeout, poll interval, and json flag", () => {
    expect(
      command([
        "message",
        "wait",
        "--to",
        "s_parent",
        "--from",
        "s_child",
        "--kind",
        "report",
        "--timeout-ms",
        "600000",
        "--poll-ms",
        "250",
        "--json",
      ]),
    ).toEqual({
      type: "message-wait",
      toSessionId: "s_parent",
      fromSessionId: "s_child",
      kind: "report",
      timeoutMs: 600000,
      pollMs: 250,
      json: true,
    });
  });

  test("requires a target Session", () => {
    expect(errorCode(["message", "wait", "--from", "s_child"])).toBe(
      "invalid_input",
    );
  });

  test("rejects invalid numeric flags", () => {
    expect(
      errorCode(["message", "wait", "--to", "s_parent", "--timeout-ms", "0"]),
    ).toBe("invalid_input");
  });
});

describe("parseArgs message send", () => {
  test("maps a positional target id and --body", () => {
    expect(command(["message", "send", "s_1", "--body", "ping"])).toEqual({
      type: "message-send",
      toSessionId: "s_1",
      body: "ping",
      json: false,
    });
  });

  test("accepts --to instead of a positional id, and --json", () => {
    expect(
      command(["message", "send", "--to", "s_2", "--body", "hi", "--json"]),
    ).toEqual({
      type: "message-send",
      toSessionId: "s_2",
      body: "hi",
      json: true,
    });
  });

  test("missing target id is invalid_input", () => {
    expect(errorCode(["message", "send", "--body", "x"])).toBe("invalid_input");
  });

  test("missing body is invalid_input", () => {
    expect(errorCode(["message", "send", "s_1"])).toBe("invalid_input");
  });

  test("extra positionals are invalid_input", () => {
    expect(errorCode(["message", "send", "s_1", "extra", "--body", "x"])).toBe(
      "invalid_input",
    );
  });
});

describe("parseArgs report parent", () => {
  test("maps --body and --json", () => {
    expect(
      command(["report", "parent", "--body", "halfway", "--json"]),
    ).toEqual({
      type: "report-parent",
      body: "halfway",
      json: true,
    });
  });

  test("missing body is invalid_input", () => {
    expect(errorCode(["report", "parent"])).toBe("invalid_input");
  });

  test("missing report subcommand is invalid_input", () => {
    expect(errorCode(["report"])).toBe("invalid_input");
  });

  test("unknown report subcommand is invalid_input", () => {
    expect(errorCode(["report", "sibling", "--body", "x"])).toBe(
      "invalid_input",
    );
  });
});
