# Config

`asem init --interactive` creates `.asem.yaml` in the Worktree Root.

## Generated config

A minimal config records the Workspace and default Templates. Generated config omits empty schema-default fields and avoids JSON-like flow-style empty collections.

```yaml
workspace:
  id: acme

defaults:
  agent: pi
  mux: tmux
```

Exact fields can grow as Templates and local defaults are configured.

## Workspace and Worktree Root

Normal visibility, parent-child relationships, Messages, and Reports use the Workspace id. Worktree Root is Session location metadata for launch files, cleanup, grouping, and explicit filters.

Repo aliases may point to directories under the Workspace root. `asem session create --repo <alias>` uses the alias as a named `cwd` shortcut without changing Workspace parent/report semantics.

## Templates

Agent Templates define command sequences for AI clients. Multiplexer Templates define how a child Session is hosted and attached. Template command sequences are runtime configuration, not workflow definitions.

## Runtime state

Token-bearing runtime files are ignored and should not be committed:

```txt
.asem/sessions/
.asem/current-session*.json
.asem/tokens/
```

Store only token hashes in SQLite. Avoid putting raw tokens in command-line arguments, pane labels, logs, or structured errors.

## Integration Target config

`asem mcp add --for` and `asem skills add --for` update the selected external AI client's config or Skill directory. Those target files are separate from `.asem.yaml`.
