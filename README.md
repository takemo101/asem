# asem

asem is a local agent Session manager for AI-assisted development. It helps a human or parent agent create child Sessions, exchange Messages, collect Reports, and inspect local work from a CLI, TUI Cockpit, or stdio MCP server.

Manual: <https://takemo101.github.io/asem/>

## Why use asem?

AI coding sessions often need more structure than a terminal tab, but less process than a task scheduler or workflow engine. asem is meant for that middle ground:

- launch and track local child Sessions from one project Workspace;
- keep Message and Report history scoped to the current Workspace and Worktree Root;
- use familiar multiplexers such as tmux, zellij, herdr, or rmux through Templates;
- shape child prompts with explicit Agent Profiles;
- let compatible AI clients connect through stdio MCP and installed Skills.

asem is intentionally small. It is not a task board, team scheduler, hosted service, workflow engine, or result evaluator.

## Install

```sh
npm install -g @takemo101/asem
```

One-off use:

```sh
npx @takemo101/asem init
# or
bunx @takemo101/asem init
```

asem is currently built for Bun-based execution. The published package installs an `asem` binary backed by the bundled CLI entrypoint.

## Quickstart

```sh
cd /path/to/your/repo
asem init --interactive
asem doctor
asem session create reviewer-1 --prompt "Review the current diff" --profile reviewer
asem message list
asem tui
```

`asem init --interactive` creates `.asem.yaml` for the current Worktree Root. `asem doctor` checks that builtin Agent and Multiplexer commands are available. `session create` launches a child Session and stores its Message history in local asem state.

## Core concepts

- **Session**: a registered agent process or child process that can receive Messages and produce Reports.
- **Message**: durable local communication addressed to a Session.
- **Report**: a child Session's summary sent to its parent Session.
- **Workspace**: logical project scope shared by related Sessions.
- **Worktree Root**: filesystem root that participates in scope isolation.
- **Effective Scope**: `workspace_id + worktree_root`, the normal boundary for visibility and messaging.
- **Multiplexer**: the terminal host used to launch or attach to a Session pane.
- **Agent Template**: command template for launching a CLI agent.
- **Agent Profile**: explicit prompt-shaping instructions and optional launch defaults.
- **Integration Target**: an external AI client whose local MCP or Skill config can be updated.

See [Concepts](https://takemo101.github.io/asem/concepts) for details.

## CLI

The CLI exposes primitive Session and Message operations:

```sh
asem session list
asem session get <id>
asem message send <session-id> --body "status?"
asem message wait
asem report parent --body "Review complete"
```

Run `asem --help` or `asem <command> --help` for focused help.

## TUI Cockpit

```sh
asem tui
```

The Cockpit is a keyboard-first local view of Sessions, Messages, and details in the Effective Scope. It is a human surface only; operation semantics live in shared ops code.

## Agent Profiles

Use Profiles to shape child Session prompts without inventing roles or workflow state:

```sh
asem profile list
asem session create reviewer-1 --profile reviewer --prompt "Review this branch"
```

Builtin Profiles include `worker`, `reviewer`, `planner`, `debugger`, `researcher`, and other focused prompt-shaping options.

## MCP and Skills

Start the stdio MCP server:

```sh
asem mcp
```

Register it with a supported Integration Target:

```sh
asem mcp add --for claude-code
asem mcp add --for opencode --no-global
```

Install agent guidance separately:

```sh
asem skills add --for pi
asem skills add --for copilot-cli
```

MCP registration and Skill installation are independent. Setup commands edit local Integration Target config files; they are not exposed through the asem MCP server.

## Configuration

`asem init --interactive` writes `.asem.yaml`. The config selects default Workspace, Agent Template, Multiplexer Template, and optional Template settings. Runtime state and token-bearing files live under ignored `.asem/` paths.

## Development docs

Public user docs live in the manual. Durable design and maintainer docs live in this repository:

- [Documentation map](./docs/README.md)
- [Domain vocabulary](./CONTEXT.md)
- [Architecture overview](./docs/architecture/overview.md)
- [Design docs](./docs/designs/README.md)
- [ADRs](./docs/adr/README.md)
