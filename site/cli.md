# CLI

The `asem` CLI exposes small primitive operations. Run focused help for exact options:

```sh
asem --help
asem session create --help
asem message send --help
```

## Setup

```sh
asem init --interactive
asem init --workspace acme --agent pi --mux tmux
asem doctor
```

`init` writes `.asem.yaml`. `doctor` checks builtin command availability without opening or migrating runtime state.

## Sessions

```sh
asem run claude
asem run claude --name reviewer --prompt "Review this branch"
asem session create reviewer-1 --profile reviewer --prompt "Review this branch"
asem session list
asem session get <session-id>
asem session peek <session-id>
asem session attach <session-id>
asem session close <session-id>
asem session delete <session-id>
```

`run` is the human entry point: it launches a root Session (no parent) from an exact configured Agent Template name. The Session name defaults to the agent name, and the launched Agent receives an English bootstrap prompt teaching the asem Message protocol; `--prompt` appends your request under `## User request`. On a TTY, `run` attaches to the new Session unless `--no-attach`; without a TTY it never attaches. If the attach fails, the Session keeps running and the command exits nonzero. There is no `--parent` — child Sessions stay `asem session create`.

`session peek` reads a live Multiplexer pane snapshot without attaching. It is not durable Message history and is returned without redaction, so use it only inside the Workspace trust boundary.

`delete` is destructive and refuses to remove a live Session. Close live Sessions first.

### Recreating a root Session after replacing a pane

A Session's stored mux reference is not edited in place. If its Multiplexer pane
was replaced, Messages remain durable but best-effort pane notification can no
longer reach that old pane. Keep or close the old Session for history, then run
`asem run <agent>` from the live environment to create a new root Session.

## Profiles

```sh
asem profile list
asem profile get reviewer
```

Profiles resolve project, then user, then builtin. A project or user Profile replaces a builtin Profile of the same id.

## Messages and Reports

Messages are durable and pull-based: the local store row is the source of truth, and pane delivery is best-effort notification.

```sh
asem message list --inbox --json
asem message list --cursor <nextCursor> --limit 50
asem message send <session-id> --body "status?"
asem message wait --cursor <nextCursor>
asem report parent --body "Review complete"
```

`message list` returns one page, ordered oldest to newest, as a shared envelope: `{ messages, nextCursor, hasMore }`. Each Message carries only the public fields `id`, `fromSessionId`, `toSessionId`, `kind`, `body`, `createdAt`, and `delivery`. Pass `nextCursor` back with `--cursor` (and the same filter) to read the next page; `--cursor latest` starts at the tail with an empty page. Cursors are opaque and bound to one query; they never grant access.

`message wait` performs one bounded wait on the current Session's unfiltered Inbox. It requires a concrete cursor from a prior `message list --inbox` page or a prior wait (never `latest`). A timeout (default 30 s, max 60 s) is a successful empty page with `timedOut: true`, not an error.

Message bodies are capped at 65,536 UTF-8 bytes, and pages default to 20 and cap at 50 Messages. A `delivery.status` of `failed` records a notification failure only — the Message is stored and is never automatically resent.

`report parent` sends a Report to the current Session's parent Session in the same Workspace.

## Repo aliases and Workspace parents

When `.asem.yaml` defines repo aliases, `--repo <alias>` is a named `cwd` shortcut:

```sh
asem session create frontend-review --repo frontend --parent <workspace-parent-id> --prompt "Review frontend"
```

The repo alias chooses where the child Session runs. It does not create a separate communication boundary, so Messages and `report parent` still follow the same Workspace Session tree.

## Surfaces

```sh
asem tui
asem mcp
```

`tui` opens the human Cockpit. `mcp` starts the stdio MCP server.

## Integration setup

```sh
asem mcp add --for claude-code
asem mcp add --for opencode --no-global
asem skills add --for pi
asem skills add --for copilot-cli
```

`--no-global` requests workspace-local configuration when the Integration Target supports it. Unsupported scopes fail clearly.
