# Manual and `.asem.yaml` configuration refresh design

## Goal

Bring the public README and manual in line with the shipped Session, Message, `asem run`, Cockpit, MCP/Skill, and configuration behavior. Give operators enough configuration guidance to set up a single repository, a monorepo, or multiple Worktree Roots sharing one Workspace without turning the manual into a duplicate runtime-template schema.

## Scope

Update public documentation only:

- `README.md`
- `site/config.md`
- `site/tui.md`
- `site/quickstart.md`
- `site/cli.md`
- `site/mcp-and-skills.md`
- any navigation/link or documentation tests required by those edits

Do not change operation behavior, config schemas, template runtime behavior, Session storage, or TUI implementation.

## Documentation structure

### README

Keep the README as the short project entry point.

- Retain install and concise Quickstart.
- Point readers to the manual for the full configuration, Cockpit, and protocol guidance.
- Refresh the summary to identify `asem run` as the root human launcher, durable pull-based Messages, and the Cockpit's Session dossier.
- Do not duplicate command options or the full YAML examples.

### CLI and Quickstart

`site/quickstart.md` presents the happy path:

1. initialize a Worktree Root;
2. verify available Agent and Multiplexer Templates with `asem doctor`;
3. use `asem run <agent>` to launch the root human Session;
4. create child Sessions and exchange pull-based Messages;
5. inspect the Cockpit; and
6. install MCP and Skills when an external client needs them.

`site/cli.md` remains the focused command reference. It must explain the current Message cursor/wait contract, root-only `asem run`, and the difference between `session create` and `run`. It must add the recovery rule for a replaced Multiplexer pane: a Session's stored mux reference is not edited in place; retain or close the old Session for history, then start a new root Session in the live pane.

### Cockpit

`site/tui.md` documents the presentation that has shipped:

- Workspace Session tree and location context on the left;
- persistent selected-Session dossier on the right;
- Messages timeline, Detail operational summary, and Context relationship/workspace tabs;
- local-only expansion state for ordinary Message bodies and Technical detail;
- Activity as a capped in-memory delta strip, not durable Message history, unread state, or an outcome log;
- mouse-wheel in-app scrolling for overflow in all three right-pane tabs, with dossier, tab bar, Activity, and global keybar fixed.

The page must retain the distinction between process/connection status and work outcome.

## Configuration guide

`site/config.md` becomes the operator-facing source for `.asem.yaml` setup. The canonical parsed shape uses `workspace`, optional `repos`, `agent`, and `mux`; existing `defaults` examples are removed because that key is not part of the current schema.

### Baseline configuration

Show the current minimal shape:

```yaml
workspace:
  id: acme

agent:
  default: pi

mux:
  default: herdr
```

Explain that `asem init --interactive` materializes the initial project config and that `asem doctor` reports builtin command availability.

### Pattern 1: one repository

Show the baseline config and a root-to-child flow. Explain that all normal visibility, parent-child relationships, Messages, and Reports are bounded by `workspace.id`.

### Pattern 2: monorepo / Repo Aliases

Add an example:

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

Demonstrate `asem workspace repo list` and `asem session create --repo frontend ...`. State plainly that a Repo Alias resolves a child Session `cwd` relative to the declaring `.asem.yaml`; it does not create a Workspace, message boundary, parent Session, or Report route.

### Pattern 3: multiple Worktree Roots, one Workspace

Show two independent Worktree Root configs with the same `workspace.id` and their own relative Repo Alias paths where needed. Explain that Worktree Root is Session location metadata and an optional filter; Sessions across those roots can still be parent/child and exchange Messages/Reports in the shared Workspace. Advise users to select distinct Workspace ids when isolation is intended.

### Templates and upgrades

Keep template content out of the YAML reference. Explain:

- `agent.templates` and `mux.templates` are materialized/local overrides;
- rerunning `asem init` does not overwrite an existing `.asem.yaml`;
- users must deliberately copy a regenerated template block or remove an obsolete project override to return to builtin behavior;
- retain the explicit herdr `send` settle-delay migration example, but frame it as one concrete materialized-template upgrade;
- token-bearing `.asem/` runtime paths remain ignored and never belong in version control.

## MCP and Skills

`site/mcp-and-skills.md` keeps MCP registration and Skill installation separate. Add that rerunning `asem skills add --for <target>` replaces only the asem-owned Skill file, so it is the supported way to update an older installed asem Skill. `--no-global` remains the workspace-local choice for targets that support it; unrelated or user-authored Skills are not removed.

## Validation

- Update documentation-link/placeholder tests for all moved or added links.
- Add assertions that public configuration examples use the current config keys (`workspace`, `agent`, `mux`, and optional `repos`) and do not reintroduce obsolete `defaults`.
- Run `bun run typecheck`, `bun run test`, and `bun run check`.

## Non-goals

- A hand-maintained, exhaustive template DSL/schema reference.
- Changing Workspace, Worktree Root, Repo Alias, Message, root Session, or TUI behavior.
- Adding workflow, task, read-receipt, remote-tenancy, or automatic-recovery concepts.
