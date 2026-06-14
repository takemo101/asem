# Install

Install the release package globally:

```sh
npm install -g @takemo101/asem
```

One-off use:

```sh
npx @takemo101/asem init
# or
bunx @takemo101/asem init
```

The installed binary is `asem`.

## Runtime expectations

asem is currently built for Bun-based execution. The published package installs a bundled CLI entrypoint, but development and tests use Bun directly.

Useful local tools depend on the Templates you choose:

- Agent CLIs such as `pi`, `claude`, `codex`, `opencode`, or compatible commands.
- Multiplexers such as `tmux`, `zellij`, `herdr`, or `rmux`.

Run diagnostics after installation:

```sh
asem doctor
```

`asem doctor` checks builtin Agent and Multiplexer command availability. Missing commands are diagnostics, not command failures.

## Initialize a project

```sh
cd /path/to/your/repo
asem init --interactive
```

This writes `.asem.yaml` for the current Worktree Root. Re-running init on an existing config leaves it unchanged.

## Next

Continue with [Quickstart](/quickstart).
