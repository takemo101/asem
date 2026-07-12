# Quickstart

Create and inspect a local child Session in one project.

## 1. Initialize the Worktree Root

```sh
cd /path/to/your/repo
asem init --interactive
```

The Init Wizard asks for a Workspace id, default Agent Template, and default Multiplexer Template. It writes `.asem.yaml`.

## 2. Check local commands

```sh
asem doctor
```

Doctor prints command availability for builtin Agent and Multiplexer Templates.

## 3. Launch the root Session

```sh
asem run pi
```

`run` creates the human root Session (no parent) and launches the named Agent in it. Child Sessions are created with `asem session create`.

## 4. Create a child Session

```sh
asem session create reviewer-1 --profile reviewer --prompt "Review the current diff"
```

The child Session is launched through the selected Multiplexer Template. The prompt is written to that Session's launch files, and local Session metadata is stored in asem state.

If the selected Agent Template supports models, pass one explicitly:

```sh
asem session create reviewer-2 --profile reviewer --model sonnet --prompt "Review the current diff"
```

## 5. Inspect Sessions and Messages

```sh
asem session list
asem message list
```

Messages and Reports are scoped by Workspace. Worktree Root is retained as Session location metadata and can be used as an explicit filter.

## 6. Open the Cockpit

```sh
asem tui
```

The Cockpit provides a keyboard-first view of local Sessions and details.

## 7. Register an AI client when needed

```sh
asem mcp add --for claude-code
asem skills add --for claude-code
```

MCP registration and Skill installation are separate. They update the selected Integration Target's local config and guidance files.

## What just happened

- `.asem.yaml` defined project defaults.
- A child Session was created with explicit prompt shaping.
- Session and Message history stayed local to the Workspace.
- The TUI and MCP server can operate over the same local state.
