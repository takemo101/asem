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

  test("unknown command is invalid_input", () => {
    expect(errorCode(["frobnicate"])).toBe("invalid_input");
  });
});

describe("parseArgs init", () => {
  test("maps --workspace to workspaceId", () => {
    expect(command(["init", "--workspace", "ws-1"])).toEqual({
      type: "init",
      workspaceId: "ws-1",
    });
  });

  test("accepts a positional workspace id", () => {
    expect(command(["init", "ws-2"])).toEqual({
      type: "init",
      workspaceId: "ws-2",
    });
  });

  test("missing workspace id is invalid_input", () => {
    expect(errorCode(["init"])).toBe("invalid_input");
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
