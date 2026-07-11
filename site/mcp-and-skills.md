# MCP & Skills

asem integrates with AI clients through two separate setup surfaces:

1. MCP registration gives an Integration Target tools to operate on local Sessions and Messages.
2. Skill installation gives an Integration Target written guidance for using asem well.

These are independent. Installing a Skill never edits MCP config, and registering MCP never writes Skill files.

## Stdio MCP server

Start the server directly:

```sh
asem mcp
```

asem remains stdio-only. It does not start an HTTP server, expose a port, add a remote auth layer, or become a scheduler.

## Register MCP with an Integration Target

```sh
asem mcp add --for pi
asem mcp add --for antigravity
asem mcp add --for jcode
asem mcp add --for claude-code
asem mcp add --for opencode
asem mcp add --for codex
asem mcp add --for copilot-vscode
asem mcp add --for copilot-cli
```

Some targets support workspace-local config through `--no-global`:

```sh
asem mcp add --for claude-code --no-global
asem mcp add --for opencode --no-global
asem mcp add --for copilot-vscode --no-global
```

Unsupported scopes fail clearly instead of silently falling back.

## MCP tools

The MCP server exposes primitive Session and Message operations. It does not expose Integration Target setup commands.

Use the MCP surface for AI-facing local operations such as listing Sessions, peeking at live Session pane output, reading paginated Message history, running bounded Inbox waits, sending Messages, and reporting to a parent Session.

`wait_messages` bounds each Inbox wait with `timeoutMs` (default 30s, max 60s). Configure the Integration Target's client tool-call deadline strictly longer than the requested `timeoutMs`: an operation timeout is a successful empty page with `timedOut: true`, not a client-side failure, and cutting the call short client-side discards that page and its cursor.

`peek_session` returns a live Multiplexer pane snapshot for a Session in the same Workspace. It does not attach to the pane, does not persist a transcript, and does not redact terminal output.

## Install Skills

```sh
asem skills add --for pi
asem skills add --for antigravity
asem skills add --for jcode
asem skills add --for claude-code
asem skills add --for opencode
asem skills add --for codex
asem skills add --for copilot-vscode
asem skills add --for copilot-cli
```

Skill guidance explains asem vocabulary, scope, safety rules, and the intended MCP tool usage for that Integration Target.

## Scope reminder

An Integration Target is an external AI client whose local config can be updated. It is not the Session Agent, and it does not add teams, task lifecycle, worker pools, or workflow state to asem.
