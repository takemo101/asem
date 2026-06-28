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
asem session create reviewer-1 --profile reviewer --prompt "Review this branch"
asem session list
asem session get <session-id>
asem session peek <session-id>
asem session attach <session-id>
asem session close <session-id>
asem session delete <session-id>
```

`session peek` reads a live Multiplexer pane snapshot without attaching. It is not durable Message history and is returned without redaction, so use it only inside the Workspace trust boundary.

`delete` is destructive and refuses to remove a live Session. Close live Sessions first.

## Profiles

```sh
asem profile list
asem profile get reviewer
```

Profiles resolve project, then user, then builtin. A project or user Profile replaces a builtin Profile of the same id.

## Messages and Reports

```sh
asem message list
asem message send <session-id> --body "status?"
asem message wait
asem report parent --body "Review complete"
```

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
