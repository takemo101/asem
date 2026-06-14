# Integration Targets Design

## Status

Draft, created 2026-06-14.

This design covers CLI-only helpers that install asem MCP and Skill configuration into external AI clients. It borrows mikan's adapter-based installer shape while preserving asem's Session-manager boundary.

## Context

asem already has an `Agent` domain term: the external AI CLI process launched inside a Session. The setup target in this design is different. It is the external AI client whose local config should learn how to use asem.

That target is an **Integration Target**.

Examples:

- Pi
- Claude Code
- Codex
- opencode
- Antigravity
- jcode
- Copilot VS Code
- Copilot CLI

Integration Target setup is local toolchain configuration. It does not create Sessions, send Messages, interpret Reports, or change `.asem.yaml`.

## Goals

- Provide mikan-like commands for registering the asem MCP server with supported Integration Targets.
- Provide mikan-like commands for installing a lightweight asem Skill document into supported Integration Targets.
- Keep setup explicit and human-triggered through the CLI.
- Keep target-specific path/schema differences isolated behind small adapters.
- Make repeated setup idempotent by upserting only the asem-owned entry or Skill file.
- Keep `.asem.yaml` focused on Workspace, Multiplexer Template, and Agent Template configuration.

## Non-goals

- No AI-facing MCP tools that mutate local Integration Target configuration.
- No TUI setup surface in the MVP.
- No `.asem.yaml` declaration of desired Integration Target state.
- No drift detection between `.asem.yaml` and external AI client config.
- No model/provider discovery, Agent Template validation, or Session launch changes.
- No workflow, role, task lifecycle, scheduling, or outcome semantics.
- No installer marketplace or remote registry.
- No shelling out to target-native setup commands in the MVP.
- No configurable MCP server command, server name, args, or env in the MVP.

## Domain language

**Integration Target** is the external AI client or tool whose local configuration can be updated so it knows how to use asem. It is not the Agent launched inside a Session.

Use `Integration Target` in docs and internal code where the subject is setup/configuration. Continue using `Agent` only for the process launched inside a Session.

## CLI surface

### MCP registration

```sh
asem mcp add --for <target>
asem mcp add --for <target> --no-global
```

`asem mcp` without `add` continues to start the AI-facing MCP server on stdio.

`--for` names the Integration Target. It intentionally avoids `--agent`, because `--agent` already means Session Agent in `asem session create`.

Default scope is global. `--no-global` requests workspace-local setup when the Integration Target supports it. This matches mikan's CLI convention.

### Skill installation

```sh
asem skills add --for <target>
asem skills add --for <target> --no-global
```

Skill installation is separate from MCP registration. A user may install one, both, or neither for a given Integration Target.

### Supported targets

The MVP target set matches mikan's installer target set:

- `pi`
- `antigravity`
- `jcode`
- `claude-code`
- `opencode`
- `codex`
- `copilot-vscode`
- `copilot-cli`

Target names are setup target identifiers, not Session Agent Template ids. For example, `claude-code` is an Integration Target, while `claude` is the builtin Session Agent Template id.

## MCP server entry

MVP registration is fixed:

```ts
serverName: "asem"
command: "asem"
args: ["mcp"]
env: {}
```

The CLI does not expose `--server-name`, `--command`, `--args`, or env flags in the MVP. This keeps setup predictable and makes repeated runs a repair operation for the standard installed command.

If a target config already has an `asem` MCP entry, setup replaces only that entry. Other MCP server entries remain untouched.

## Skill document

`asem skills add` installs one shared asem Skill document for all Integration Targets. Target adapters only decide where and how that document is written.

The Skill should teach agents to:

- treat asem as a local Session manager;
- use Session, Message, Report, Workspace, Worktree Root, Effective Scope, Multiplexer, Agent, Template, Command Sequence, Cockpit, Agent Profile, and Integration Target vocabulary precisely;
- prefer asem MCP tools when available;
- fall back to CLI commands when MCP is unavailable;
- avoid inferring task success, workflow completion, or durable unread state from Session status, Reports, or Messages;
- avoid editing `.asem/sessions/`, token files, and generated runtime state directly.

If the target Skill file already exists at the asem-owned path, setup replaces it with the current shared document. This is an idempotent repair/update operation.

## Scope behavior

Global setup is the default.

`--no-global` requests workspace-local setup. If a target does not support the requested scope, the command fails with a clear unsupported-scope error. It must not silently fall back to global setup, because that would write a broader configuration than the user requested.

Each adapter reports the resolved path and scope in its result so the CLI can render a precise success message.

## Source of truth

The target AI client's configuration file is the source of truth for installed MCP entries and Skills.

`.asem.yaml` remains the source of truth for asem Workspace and Template configuration only:

```yaml
workspace:
  id: my-workspace

mux:
  default: herdr

agent:
  default: claude
```

Integration Target setup must not mutate `.asem.yaml` and must not require `.asem.yaml` to contain desired installer state.

## Package architecture

Add `@asem/integrations`.

| Package | Responsibility |
|---|---|
| `@asem/integrations` | Integration Target registry, MCP config adapters, Skill target adapters, shared asem Skill document, atomic file writes, parser/serializer helpers needed by target configs |
| `@asem/cli` | Parse `mcp add` / `skills add`, call `@asem/integrations`, render human success/error output |

`@asem/integrations` should not depend on `@asem/ops`, `@asem/store`, `@asem/runtime`, `@asem/mcp`, or `@asem/tui`. It may depend on `@asem/core` only if shared domain types become useful; the MVP can likely remain independent.

`@asem/ops` should not own these installers because they are not Session/Message use cases. `@asem/mcp` should not expose them because the operation mutates local human toolchain configuration.

## Adapter model

MCP installer adapters encode only target-specific config location and entry schema differences:

```ts
type IntegrationTarget =
  | "pi"
  | "antigravity"
  | "jcode"
  | "claude-code"
  | "opencode"
  | "codex"
  | "copilot-vscode"
  | "copilot-cli";

type InstallScope = "global" | "workspace" | "cli-global";

type McpTargetAdapter = {
  target: IntegrationTarget;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
  readMergeWrite(options: InstallOptions, entry: McpServerEntry): InstallResult;
};
```

Skill installer adapters encode only target-specific Skill path conventions:

```ts
type SkillTargetAdapter = {
  target: IntegrationTarget;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
};
```

Shared helpers own:

- default global/workspace selection;
- path resolution using `cwd` and `home` inputs;
- JSON/TOML/text read and write helpers;
- atomic temp-file-and-rename writes;
- existing file mode preservation where possible;
- unknown target and unsupported-scope errors.

## Error handling

Errors should be structured enough for tests and simple enough for CLI rendering.

Required error cases:

- missing `--for` value;
- unknown Integration Target;
- unsupported requested scope;
- invalid existing config file syntax;
- existing config shape that cannot safely be merged;
- filesystem write/read errors.

Invalid existing configuration should fail rather than overwrite the file with a new empty config, unless the file is missing. Missing config files may be created with parent directories as needed.

## Security and state rules

- Setup writes only the resolved Integration Target config path or Skill path.
- Setup must not write token material.
- Setup must not create Sessions or Messages.
- Setup must not open, migrate, or require `~/.asem/state.db`.
- Setup must not mutate `.asem.yaml`.
- Setup should preserve unrelated user config entries.
- Setup should use atomic writes to avoid truncating config files on failure.

## Relationship to incur

mikan uses `incur` for MCP tool definition and manifest behavior, while its `mcp add` / `skills add` installers are adapter-based file updaters.

This design follows the installer pattern only. It does not introduce `incur` to asem. Any future `incur` migration for the asem MCP server should be a separate design and implementation effort.

## Testing expectations

- Unit tests for every supported Integration Target adapter:
  - global path resolution;
  - workspace path resolution when supported;
  - unsupported-scope failure when not supported;
  - target-specific MCP entry shape;
  - target-specific Skill path.
- Shared installer tests:
  - missing files are created;
  - existing config is merged without removing unrelated entries;
  - existing `asem` entry is replaced;
  - invalid config fails without rewriting;
  - atomic writes preserve existing mode where applicable.
- CLI tests:
  - `asem mcp` still means start stdio server;
  - `asem mcp add --for pi` calls MCP installer and renders path/scope;
  - `asem mcp add --for pi --no-global` requests workspace scope;
  - missing/unknown `--for` renders a usage/error message;
  - `asem skills add --for pi` calls Skill installer;
  - setup commands do not initialize full runtime deps or open SQLite state.
- Documentation link tests should include this design file in the existing docs scan.
