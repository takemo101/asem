# Config

`.asem.yaml` lives at the Worktree Root — the top of the working copy asem manages. `asem init --interactive` creates it and materializes the initial project config; `asem doctor` reports whether the configured builtin commands are available.

## Minimal configuration

The smallest valid config names the Workspace and picks the default Agent and Multiplexer Templates:

```yaml
workspace:
  id: acme

agent:
  default: pi

mux:
  default: herdr
```

`workspace.id` is the safety boundary: normal Session visibility, parent-child relationships, Messages, and Reports are scoped to it. `agent.default` and `mux.default` name the Templates used when a command does not choose one explicitly. The optional `repos` map is covered below.

## One repository

For a single repository, the minimal config above is complete. A typical first session:

```sh
asem doctor
asem run pi
```

`asem run pi` launches the human root Session. From there, create child Sessions:

```sh
asem session create reviewer --prompt "Review the current diff"
```

Every Session created under this Worktree Root joins Workspace `acme`. Sessions in the same Workspace can see each other, exchange Messages, and children send Reports to their Parent Session. Nothing outside the Workspace participates in that traffic.

## Monorepo with Repo Aliases

In a monorepo, declare Repo Aliases so child Sessions start in the right subdirectory:

```yaml
workspace:
  id: acme

repos:
  frontend:
    path: apps/frontend
  api:
    path: services/api

agent:
  default: pi

mux:
  default: herdr
```

List the declared aliases with `asem workspace repo list`, then use one at Session creation:

```sh
asem session create frontend-review --repo frontend --prompt "Review the frontend diff"
```

Each `path` resolves relative to the `.asem.yaml` that declares it. A Repo Alias is only a `cwd` shortcut: `--repo` changes the child Session's working directory and nothing else. It does not create a new Workspace, a parent relationship, or any Message/Report boundary — the child is still an ordinary member of Workspace `acme`.

## Multiple Worktree Roots, one Workspace

One Workspace can span multiple Worktree Roots. Give each checkout its own `.asem.yaml` with the same `workspace.id`:

`~/work/worktree-a/.asem.yaml`:

```yaml
workspace:
  id: acme

agent:
  default: pi

mux:
  default: herdr
```

`~/work/worktree-b/.asem.yaml`:

```yaml
workspace:
  id: acme

repos:
  api:
    path: services/api

agent:
  default: pi

mux:
  default: herdr
```

The shape is: Workspace acme → worktree-a / worktree-b. Sessions launched from either root share one Session tree and one Message/Report boundary: a Session in worktree-a can be the Parent Session of a child in worktree-b, and they exchange Messages and Reports as usual. Worktree Root is location metadata — it records where a Session's files and execution context live and serves as an optional filter (for example in the Cockpit), not a communication boundary. Repo Alias paths still resolve relative to their own declaring `.asem.yaml`.

If two checkouts should *not* see each other, give them different Workspace ids. Distinct ids are the intentional way to isolate checkouts; sharing an id across multiple Worktree Roots is the intentional way to supervise them together.

## Templates and upgrades

`agent.templates` and `mux.templates` hold project-local Template overrides layered over the builtins. `asem init` materializes Templates only when no `.asem.yaml` exists yet; it never rewrites an existing config. That means a materialized or customized template block keeps its old command sequence until you change it: to pick up refreshed builtin behavior, deliberately copy a regenerated block into your config, or remove the obsolete project override so the builtin applies again.

### Upgrading a materialized herdr template

One concrete materialized-template upgrade: the builtin `herdr` `send` sequence now inserts a short settle delay between `agent send` and the Enter keystroke, so text injected by `herdr agent send` (including Kimi's paste-based prompt flow) lands before it is submitted. A `mux.templates.herdr` you materialized earlier — or customized — keeps its old sequence. If your project-local template still submits Enter immediately after `agent send`, add the delay step yourself:

```yaml
mux:
  templates:
    herdr:
      send:
        - type: run
          command: >-
            herdr --session {{herdr_session_shell}} agent wait
            {{pane_id_shell}} --status idle --timeout 30000
          on_error: ignore
        - type: run
          command: >-
            herdr --session {{herdr_session_shell}} agent send
            {{pane_id_shell}} {{message_shell}}
        - type: wait_ms
          ms: 200
        - type: run
          command: >-
            herdr --session {{herdr_session_shell}} pane send-keys
            {{pane_id_shell}} Enter
```

Alternatively, delete the `herdr` entry from `mux.templates` to fall back to the builtin definition, or re-run `asem init --interactive` in a fresh checkout and copy the regenerated block.

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
