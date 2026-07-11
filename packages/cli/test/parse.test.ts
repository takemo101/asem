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

  test("--version and -v request the package version", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs(["-v"])).toEqual({ kind: "version" });
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

  test("direct command help carries the command topic", () => {
    expect(helpTopic(["doctor", "--help"])).toBe("doctor");
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

describe("parseArgs integrations", () => {
  test("mcp add maps --for and defaults global", () => {
    expect(command(["mcp", "add", "--for", "pi"])).toEqual({
      type: "mcp-add",
      target: "pi",
      global: true,
    });
  });

  test("mcp add maps --no-global", () => {
    expect(command(["mcp", "add", "--for", "pi", "--no-global"])).toEqual({
      type: "mcp-add",
      target: "pi",
      global: false,
    });
  });

  test("mcp with no subcommand still maps to the stdio server command", () => {
    expect(command(["mcp"])).toEqual({ type: "mcp" });
  });

  test("mcp add requires --for", () => {
    expect(errorCode(["mcp", "add"])).toBe("invalid_input");
  });

  test("unknown mcp subcommand is invalid_input", () => {
    expect(errorCode(["mcp", "frob"])).toBe("invalid_input");
  });

  test("skills add maps --for", () => {
    expect(command(["skills", "add", "--for", "claude-code"])).toEqual({
      type: "skills-add",
      target: "claude-code",
      global: true,
    });
  });

  test("skills add maps --no-global", () => {
    expect(command(["skills", "add", "--for", "pi", "--no-global"])).toEqual({
      type: "skills-add",
      target: "pi",
      global: false,
    });
  });

  test("skills add requires --for", () => {
    expect(errorCode(["skills", "add"])).toBe("invalid_input");
  });

  test("skills with no subcommand is invalid_input", () => {
    expect(errorCode(["skills"])).toBe("invalid_input");
  });

  test("help topics resolve for the new command forms", () => {
    const mcpAdd = parseArgs(["mcp", "add", "--help"]);
    expect(mcpAdd.kind).toBe("help");
    if (mcpAdd.kind === "help") expect(mcpAdd.topic).toBe("mcp add");
    const skills = parseArgs(["skills", "--help"]);
    expect(skills.kind).toBe("help");
    if (skills.kind === "help") expect(skills.topic).toBe("skills");
    const skillsAdd = parseArgs(["skills", "add", "--help"]);
    expect(skillsAdd.kind).toBe("help");
    if (skillsAdd.kind === "help") expect(skillsAdd.topic).toBe("skills add");
  });
});

describe("parseArgs doctor", () => {
  test("maps doctor with optional json", () => {
    expect(command(["doctor"])).toEqual({ type: "doctor", json: false });
    expect(command(["doctor", "--json"])).toEqual({
      type: "doctor",
      json: true,
    });
  });

  test("rejects unknown flags and extra args", () => {
    expect(errorCode(["doctor", "--strict"])).toBe("invalid_input");
    expect(errorCode(["doctor", "extra"])).toBe("invalid_input");
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

  test("--repo maps to repo", () => {
    expect(
      command([
        "session",
        "create",
        "fe-parent",
        "--prompt",
        "do it",
        "--repo",
        "frontend",
        "--root",
      ]),
    ).toMatchObject({ type: "session-create", repo: "frontend" });
  });

  test("omitting --repo leaves repo unset", () => {
    expect(
      command(["session", "create", "reviewer-1", "--prompt", "do it"]),
    ).not.toHaveProperty("repo");
  });

  test("--repo and --cwd are mutually exclusive", () => {
    expect(
      errorCode([
        "session",
        "create",
        "x",
        "--prompt",
        "p",
        "--repo",
        "frontend",
        "--cwd",
        "/somewhere",
      ]),
    ).toBe("invalid_input");
  });

  test("--repo with no value is invalid_input", () => {
    expect(
      errorCode(["session", "create", "x", "--prompt", "p", "--repo"]),
    ).toBe("invalid_input");
  });

  test("--profile maps to profile", () => {
    expect(
      command([
        "session",
        "create",
        "reviewer-1",
        "--prompt",
        "do it",
        "--profile",
        "reviewer",
      ]),
    ).toMatchObject({ type: "session-create", profile: "reviewer" });
  });

  test("omitting --profile leaves profile unset", () => {
    expect(
      command(["session", "create", "reviewer-1", "--prompt", "do it"]),
    ).not.toHaveProperty("profile");
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

describe("parseArgs run", () => {
  test("parses the agent positional with attach defaults", () => {
    expect(command(["run", "claude"])).toEqual({
      type: "run",
      agent: "claude",
      noAttach: false,
    });
  });

  test("parses --name, --prompt, and --no-attach", () => {
    expect(
      command([
        "run",
        "claude",
        "--name",
        "helper",
        "--prompt",
        "fix the build",
        "--no-attach",
      ]),
    ).toEqual({
      type: "run",
      agent: "claude",
      name: "helper",
      prompt: "fix the build",
      noAttach: true,
    });
  });

  test("missing agent is invalid", () => {
    expect(errorCode(["run"])).toBe("invalid_input");
  });

  test("empty --name is invalid", () => {
    expect(errorCode(["run", "claude", "--name", ""])).toBe("invalid_input");
  });

  test("rejects extra positionals", () => {
    expect(errorCode(["run", "claude", "extra"])).toBe("invalid_input");
  });

  test("rejects any parent-selection or unsupported flags", () => {
    // Root-only launcher: only --name, --prompt, and --no-attach exist.
    expect(errorCode(["run", "claude", "--parent", "s_1"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["run", "claude", "--root"])).toBe("invalid_input");
    expect(errorCode(["run", "claude", "--json"])).toBe("invalid_input");
    expect(errorCode(["run", "claude", "--agent", "codex"])).toBe(
      "invalid_input",
    );
  });

  test("run --help carries the run topic", () => {
    const result = parseArgs(["run", "--help"]);
    expect(result.kind).toBe("help");
    if (result.kind === "help") expect(result.topic).toBe("run");
  });
});

describe("parseArgs workspace repo list", () => {
  test("maps `workspace repo list` and defaults json to false", () => {
    expect(command(["workspace", "repo", "list"])).toEqual({
      type: "workspace-repo-list",
      json: false,
    });
  });

  test("`workspace repo list --json` sets json", () => {
    expect(command(["workspace", "repo", "list", "--json"])).toEqual({
      type: "workspace-repo-list",
      json: true,
    });
  });

  test("missing workspace subcommand is invalid_input", () => {
    expect(errorCode(["workspace"])).toBe("invalid_input");
  });

  test("unknown workspace subcommand is invalid_input", () => {
    expect(errorCode(["workspace", "frobnicate"])).toBe("invalid_input");
  });

  test("missing repo subcommand is invalid_input", () => {
    expect(errorCode(["workspace", "repo"])).toBe("invalid_input");
  });

  test("unknown repo subcommand is invalid_input", () => {
    expect(errorCode(["workspace", "repo", "frobnicate"])).toBe(
      "invalid_input",
    );
  });

  test("extra positionals are invalid_input", () => {
    expect(errorCode(["workspace", "repo", "list", "extra"])).toBe(
      "invalid_input",
    );
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
      force: false,
      json: false,
    });
  });

  test("session close maps --force", () => {
    expect(command(["session", "close", "s_1", "--force"])).toEqual({
      type: "session-close",
      id: "s_1",
      force: true,
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

describe("parseArgs profile", () => {
  test("profile list maps to profile-list", () => {
    expect(command(["profile", "list"])).toMatchObject({
      type: "profile-list",
      json: false,
    });
  });

  test("profile list --json sets json", () => {
    expect(command(["profile", "list", "--json"])).toMatchObject({
      type: "profile-list",
      json: true,
    });
  });

  test("profile get <id> maps to profile-get", () => {
    expect(command(["profile", "get", "reviewer"])).toMatchObject({
      type: "profile-get",
      id: "reviewer",
      json: false,
    });
  });

  test("profile get without an id is invalid_input", () => {
    expect(errorCode(["profile", "get"])).toBe("invalid_input");
  });

  test("missing profile subcommand is invalid_input", () => {
    expect(errorCode(["profile"])).toBe("invalid_input");
  });

  test("unknown profile subcommand is invalid_input", () => {
    expect(errorCode(["profile", "frobnicate"])).toBe("invalid_input");
  });

  test("profile --help is a help topic", () => {
    const result = parseArgs(["profile", "--help"]);
    expect(result.kind).toBe("help");
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

  test("message list parses --cursor and --limit", () => {
    expect(
      command(["message", "list", "--cursor", "c_opaque", "--limit", "10"]),
    ).toEqual({
      type: "message-list",
      cursor: "c_opaque",
      limit: 10,
      json: false,
    });
  });

  test("message list accepts the literal latest cursor", () => {
    expect(command(["message", "list", "--cursor", "latest"])).toEqual({
      type: "message-list",
      cursor: "latest",
      json: false,
    });
  });

  test("message list rejects a non-positive-integer --limit", () => {
    expect(errorCode(["message", "list", "--limit", "0"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["message", "list", "--limit", "abc"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["message", "list", "--limit", "1.5"])).toBe(
      "invalid_input",
    );
  });
});

describe("parseArgs message wait", () => {
  test("maps the required cursor plus optional limit, timeout, and json flag", () => {
    expect(
      command([
        "message",
        "wait",
        "--cursor",
        "c_opaque",
        "--limit",
        "10",
        "--timeout-ms",
        "60000",
        "--json",
      ]),
    ).toEqual({
      type: "message-wait",
      cursor: "c_opaque",
      limit: 10,
      timeoutMs: 60000,
      json: true,
    });
  });

  test("a bare wait omits the optional fields", () => {
    expect(command(["message", "wait", "--cursor", "c_opaque"])).toEqual({
      type: "message-wait",
      cursor: "c_opaque",
      json: false,
    });
  });

  test("requires an Inbox cursor", () => {
    expect(errorCode(["message", "wait"])).toBe("invalid_input");
  });

  test("the legacy arbitrary-history filters are gone", () => {
    expect(errorCode(["message", "wait", "--to", "s_parent"])).toBe(
      "invalid_input",
    );
    expect(errorCode(["message", "wait", "--from", "s_child"])).toBe(
      "invalid_input",
    );
    expect(
      errorCode(["message", "wait", "--cursor", "c", "--kind", "report"]),
    ).toBe("invalid_input");
    expect(
      errorCode(["message", "wait", "--cursor", "c", "--poll-ms", "250"]),
    ).toBe("invalid_input");
  });

  test("rejects positional arguments", () => {
    expect(errorCode(["message", "wait", "s_parent"])).toBe("invalid_input");
  });

  test("rejects invalid numeric flags", () => {
    expect(
      errorCode(["message", "wait", "--cursor", "c", "--timeout-ms", "0"]),
    ).toBe("invalid_input");
    expect(
      errorCode(["message", "wait", "--cursor", "c", "--limit", "abc"]),
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
