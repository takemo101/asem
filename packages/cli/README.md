# @takemo101/asem

asem is a local agent Session manager for AI-assisted development. It helps a human or parent agent create child Sessions, exchange Messages, collect Reports, and inspect local work from a CLI, TUI Cockpit, or stdio MCP server.

Manual: <https://takemo101.github.io/asem/>  
Repository: <https://github.com/takemo101/asem>

## Install

Recommended with Bun:

```sh
bun install -g @takemo101/asem
```

npm also works when `bun` is available on your `PATH`:

```sh
npm install -g @takemo101/asem
```

The package installs the `asem` binary. It is built for Bun-based execution, so install [Bun](https://bun.sh/) before running `asem`.

Verify the installed version:

```sh
asem --version
```

## Quickstart

```sh
cd /path/to/your/repo
asem init --interactive
asem doctor
asem session create reviewer-1 --profile reviewer --prompt "Review the current diff"
asem message list
asem tui
```

## What it provides

- **Local Sessions**: create and inspect child agent Sessions in a Workspace and Worktree Root.
- **Messages and Reports**: keep durable local communication history between parent and child Sessions.
- **Multiplexer Templates**: launch through tmux, zellij, herdr, rmux, or project-local Templates.
- **Agent Profiles**: shape child prompts with explicit Profiles such as `reviewer`, `worker`, and `planner`.
- **TUI Cockpit**: inspect Sessions and local activity from a keyboard-first terminal surface.
- **Stdio MCP server**: expose primitive Session and Message operations to compatible AI clients.
- **Integration Target setup**: register MCP or install Skill guidance for supported external AI clients.

asem is intentionally small. It is not a task board, scheduler, hosted service, workflow engine, or result evaluator.

## Built-in Agent Templates

asem ships with built-in Agent Templates for common agent CLIs:

- `claude`, `codex`, `pi`, `gemini` — positional prompt seeds the interactive session.
- `agy` — uses `--prompt-interactive` for the initial prompt.
- `opencode` — uses `--prompt` for the initial interactive TUI prompt.
- `kimi` — starts the interactive TUI bare and pastes the prompt after a boot delay (`paste_prompt: true`); it uses `-m` for model selection.

Use `asem doctor` to check that the selected Agent CLI is installed and reachable.

## More information

See the manual for concepts, CLI usage, TUI behavior, Agent Profiles, MCP setup, Skills, and configuration:

<https://takemo101.github.io/asem/>
