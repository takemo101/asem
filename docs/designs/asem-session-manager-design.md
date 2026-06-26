# asem Session Manager Design

## Status

Draft, created from `HANDOFF.md` and `CONTEXT.md` on 2026-06-05.

This document follows the style and boundary discipline used in cuekit design notes, especially:

- protocol / operation semantics first;
- local-first state;
- minimal persistent model;
- clear package boundaries;
- explicit non-goals to prevent orchestration drift.

## Context

`asem` is a new project separate from cuekit. It is a local **agent session manager** for starting, registering, attaching to, and messaging agent CLI sessions running inside terminal multiplexers.

The core need is simple: a human operator or an already-running agent should be able to create or discover local agent Sessions, send them messages, receive reports, and attach to their panes without introducing a task manager or workflow engine.

cuekit is useful as a reference for documentation style, local-first persistence, shared command surfaces, and package boundaries. It is not the product model for asem. cuekit concepts such as task teams, strategies, roles, coordinators, task lifecycle events, and result normalization are intentionally excluded from asem MVP.

## Product statement

asem provides one CLI and one MCP surface backed by the same operation handlers and schemas. The initial product lets a local operator or agent:

1. register the current agent process as a Session;
2. launch new agent Sessions through configured multiplexer and agent templates;
3. list Sessions in the current Workspace, with location filters when needed;
4. send a Message to another Session;
5. report to a parent Session;
6. view Message history, including self-addressed history;
7. attach to a Session's multiplexer pane from the CLI/TUI;
8. close or delete Sessions.

## Goals

- Manage live local agent CLI Sessions running inside terminal multiplexers.
- Keep normal visibility, parent-child relationships, Messages, and Reports bounded by `workspace_id`.
- Store durable Session and Message records in SQLite.
- Store sensitive and run-specific files under the worktree-local `.asem/sessions/<session_id>/` directory.
- Use command sequence templates for multiplexer and agent integration instead of fixed TypeScript adapter classes.
- Expose CLI and MCP through shared `@asem/ops` operation handlers and `@asem/core` schemas/contracts.
- Provide a human TUI cockpit for inspecting, messaging, attaching to, closing, and deleting Sessions.
- Keep the MVP small enough to test with fake command runners before relying on real multiplexers.

## Non-goals

asem must not drift into cuekit-like task orchestration. The MVP must not include:

- task lifecycle states such as completed, failed, or blocked;
- task events or event streams;
- team strategies, roles, positions, coordinators, or workflow scripts;
- result normalization or success/failure interpretation;
- automatic scheduling, auto-wake, or worker pools;
- worktree creation or git branch management;
- artifact management;
- durable read/unread semantics;
- broadcast or role-targeted messaging;
- template marketplace or DB-managed templates.

## Domain language and drift guards

### Session

A Session is one registered agent CLI process running in a multiplexer pane. A Session may have a parent Session. Parent-child relationships may be arbitrarily deep, but they do not imply work ownership, completion, or workflow state.

Session status is process/connection state only:

```ts
type SessionStatus =
  | "starting"
  | "running"
  | "exited"
  | "missing"
  | "closed";
```

Do not use Session status to represent task outcome.

### Message

A Message is a durable SQLite record plus a best-effort delivery attempt into the target Session's multiplexer pane. `asem message wait` polls the durable Message store; it does not depend on pane delivery or agent CLI state.

```ts
type MessageKind = "message" | "report";
```

`report_parent` is implemented as `Message(kind="report")` addressed to the current Session's `parent_session_id`.

### Report

A Report is just a Message from a child Session to its parent Session. It does not close the Session and does not mean the work is complete.

### Workspace and Session location

- `workspace_id` is the normal safety boundary from `.asem.yaml`.
- `worktree_root` is the realpathed Git worktree root, or cwd realpath outside Git.
- A Session stores both `cwd` and `worktree_root` as location metadata.

Normal Session visibility, Message sending, Reports, and parent-child relationships are Workspace-scoped. They require matching `workspace_id`, not matching `worktree_root`.

Within one Workspace, Session names are unique. A root Session may run from the Workspace root while child Sessions run from repo-specific cwd values.

### Inbox

There is no formal inbox protocol in the MVP. `list_messages --inbox` and MCP `list_messages({ inbox: true })` filter Message history to rows addressed to the current Session. This is self-addressed history, not durable unread state.

### Role

There is no `role` field in MVP. Session specialization should be expressed through Session names, prompts, parent relation, and agent templates.

## Workspace resolution and location resolution

Operations that read or mutate Sessions or Messages first resolve the Workspace:

1. Load `.asem.yaml` and read `workspace.id`.
2. Use `workspace_id` as the normal boundary for Session lookup, parent-child relationships, Messages, and Reports.

Operations that create or launch a Session also resolve location metadata from the Session cwd:

1. Resolve `cwd` from explicit `cwd`, `repo`, or the caller cwd.
2. Resolve `worktree_root`:
   1. run `git rev-parse --show-toplevel` if available;
   2. realpath the result;
   3. if Git lookup fails, realpath cwd.
3. Store both `cwd` and `worktree_root` on the Session.
4. Place runtime files under `<worktree_root>/.asem/sessions/<session_id>/`.

TUI is a Workspace cockpit by default, with worktree/repo-focused filters still available:

```sh
asem tui                  # Workspace cockpit
asem tui --scope worktree # compatibility spelling for current-worktree filter
asem tui --scope workspace
```

- `workspace` shows all Sessions with the same `workspace_id`, grouped by `worktree_root`.
- `worktree` filters that Workspace view to the current `worktree_root`.
- Existing `--scope worktree` wording is UI compatibility; Worktree Root is not the normal relationship boundary.
- TUI operations are human operator actions. A TUI send remains operator-originated and is not attributed to a target worktree's current Session; see [ADR 0003](../adr/0003-tui-operator-message-attribution.md).
- There is no `--scope all` in MVP.

## Config design

Config file:

```text
.asem.yaml
```

Initial generated shape:

```yaml
workspace:
  id: my-workspace

mux:
  default: herdr

agent:
  default: claude
```

A workspace-root config may also define repo aliases for creating Sessions from a directory that contains multiple working copies:

```yaml
workspace:
  id: product-x

repos:
  frontend:
    path: ./frontend
  backend:
    path: ./backend

mux:
  default: herdr

agent:
  default: claude
```

Rules:

- `workspace.id` is required after `asem init`.
- `repos` is optional. Each key is a Repo Alias and each `path` is resolved relative to the config file that declares it.
- A Repo Alias is only a cwd shortcut for Session creation. It does not create a scope boundary or special Parent Session, Message, or Report semantics.
- `repos.<alias>.path` must resolve to an existing directory under the Workspace root before `create_session` side effects begin. The target may be a Git worktree or any directory accepted by the normal location resolver realpath fallback.
- Builtin templates are available even when project-local `templates` is omitted or empty.
- Generated config uses block-style YAML and avoids flow-style empty collection notation such as `: {}` or `: []`. Empty schema-default fields such as empty `templates` maps, empty command sequences, empty `attach_command`, and empty `refs` maps are omitted. Hand-written config may still use explicit YAML flow-style empty collections; parsing remains representation-neutral.
- `asem init --interactive` may materialize the selected builtin Agent and Multiplexer Templates into project-local `templates`; see [`init-wizard-design.md`](./init-wizard-design.md).
- Non-interactive `asem init --workspace <id> --agent <name> --mux <name>` may also materialize selected builtin Templates.
- Project-local templates and repo aliases are trusted like local code.
- Multiple worktrees may share the same `workspace.id`; normal Session relationships and communication are Workspace-scoped, while worktree roots remain location metadata and filters.
- No `config validate` command in MVP.

### Config discovery

The handoff fixes the config filename and schema but not the exact search behavior. MVP should treat this as a proposed default until implementation validates it:

1. Start at cwd.
2. Walk upward until a `.asem.yaml` is found.
3. Stop at filesystem root.
4. If missing for commands that require project config, return a structured `config_not_found` error suggesting `asem init`.

`asem init` creates `.asem.yaml` in the current worktree root by default.

### Repo alias creation from a workspace root

`asem session create --repo <alias>` is a cwd convenience for Workspace operation. It resolves `<alias>` through the discovered Workspace `.asem.yaml` that contains a `repos` map, validates that the configured path exists under the Workspace root, and then launches the Session with the resolved path as its `cwd`.

For example:

```sh
cd ~/work/product-x
eval "$(asem init-session --name product-root --root --mux herdr)"
asem session create frontend-parent \
  --repo frontend \
  --prompt "Act as the parent Session for frontend work."
```

creates this Workspace Session tree:

```text
product-root cwd=~/work/product-x
└── frontend-parent cwd=~/work/product-x/frontend
```

The repo Session is a child of the Workspace current Session because `session create` used neither `--root` nor `--parent`. The repo alias only chose the child Session's cwd.

The same relationship can be made explicit:

```sh
asem session create frontend-parent \
  --repo frontend \
  --parent <product-root-session-id> \
  --prompt "Report progress with: asem report parent --body ..."
```

Repo alias rules:

- `--repo` and `--cwd` are mutually exclusive because both choose the Session cwd.
- `repo` is supported by CLI and MCP `create_session`; alias resolution is shared operation behavior owned by `@asem/ops`.
- The Workspace `.asem.yaml` remains the config source for workspace id, Agent defaults, Multiplexer defaults, Agent Profiles, and project-local templates used by the create operation.
- The resolved repo path becomes the Session `cwd`, and location resolution records `worktree_root` from that target cwd: Git root when available, otherwise realpath.
- Parent resolution is Workspace-scoped. `--root` creates a parentless Session; `--parent <id>` must name a Session in the same Workspace; with no parent flag, the Workspace current Session fallback is used.
- `session create` does not update the Workspace current Session, so one root/current Session can create multiple repo parent Sessions in sequence.
- A repo parent may create child Sessions normally. Those child and grandchild Sessions use the Workspace `parent_session_id` chain; `report_parent` sends to the direct Parent Session as usual.
- Message and Report storage/delivery stay inside the Workspace. There is no task, workflow, worker-pool, or cross-Workspace orchestration model in this design.
- `asem workspace repo list` reads the discovered config and renders aliases, resolved paths, and whether each path currently exists as a directory under the Workspace root. It does not read Session state.

## Persistence model

### Global database

Use one global SQLite database:

```text
~/.asem/state.db
```

The global DB enables discovery across local shells and agent processes while still enforcing the Workspace boundary.

### Worktree-local Session directories

Use worktree-local generated directories:

```text
<worktree_root>/.asem/sessions/<session_id>/
```

`asem init` should add ignore rules for runtime-generated token/log state:

```gitignore
.asem/sessions/
.asem/current-session*.json
.asem/tokens/
```

Raw Session tokens, prompt files, launch scripts, and run logs live in the Session directory. If a current-session file contains token material, it must either match the ignored `current-session*.json` pattern or store only a pointer to a token-bearing file under an ignored path. Token-bearing files must be mode `0600`. The DB stores token hashes only.

### `sessions` table

```sql
create table sessions (
  id text primary key,
  workspace_id text not null,
  worktree_root text not null,
  name text not null,
  cwd text not null,
  agent text not null,
  mux text not null,
  model text,
  profile text,
  profile_source text,
  parent_session_id text,
  status text not null,
  mux_ref_json text not null,
  session_dir text not null,
  token_hash text not null,
  created_at text not null,
  updated_at text not null,
  closed_at text
);

create unique index sessions_workspace_name_unique
  on sessions(workspace_id, name);

create index idx_sessions_workspace_status
  on sessions(workspace_id, status);

create index idx_sessions_workspace_worktree
  on sessions(workspace_id, worktree_root);
```

Notes:

- `mux_ref_json` stores multiplexer-specific coordinates such as herdr workspace/tab/pane or tmux session/window/pane.
- `model` is the nullable model the Session was launched with (MIK-040). It is launch metadata only: asem does not validate model names, map aliases, select providers, or infer Agent capability from it. Existing rows migrate forward as `model = null`.
- `profile` / `profile_source` record the optional Agent Profile id and resolved source (`project`, `user`, or `builtin`) selected for Session creation. Profile instructions are not duplicated into SQLite; the effective prompt remains in `prompt.md`. See [Agent Profiles Design](./agent-profiles-design.md).
- `parent_session_id` must point to a Session in the same Workspace for normal operations.
- There is no `role` or `metadata_json` in MVP.

### `messages` table

```sql
create table messages (
  id text primary key,
  workspace_id text not null,
  worktree_root text not null,
  from_session_id text,
  to_session_id text not null,
  kind text not null,
  body text not null,
  formatted_body text not null,
  delivered_at text,
  delivery_error text,
  created_at text not null
);

create index idx_messages_workspace_created
  on messages(workspace_id, created_at desc);

create index idx_messages_workspace_worktree_created
  on messages(workspace_id, worktree_root, created_at desc);

create index idx_messages_to_created
  on messages(to_session_id, created_at desc);

create index idx_messages_delivery_error
  on messages(workspace_id, delivery_error);
```

Message guarantees:

- Persist the Message before or with the delivery result.
- Delivery is best-effort.
- Herdr delivery waits for the target agent pane to report `idle` before injecting input; that wait is best-effort and ignored on timeout/failure so the durable Message row remains the source of truth.
- If target pane exists and delivery command succeeds, set `delivered_at`.
- If delivery fails, set `delivery_error`.
- No ack, read receipt, or durable unread state.

Close/delete rule:

- `close_session` normally runs the mux template `close` sequence for a live Session, then records status `closed`.
- `close_session --force` is the explicit recovery path for a known-stale live Session whose mux resource has already disappeared. It attempts the mux `close` sequence; if that sequence fails, it still records status `closed` while preserving Message/Report history. Without `--force`, mux close failure leaves the stored status unchanged.
- Sessions registered with `init-session` borrow an already-existing pane/workspace rather than owning a mux resource. Their `mux_ref_json` carries `asem_mux_owned = "false"`; `close_session` skips mux `close` for those Sessions and records only the status transition. This prevents deleting a parent/current Session from closing the operator's existing herdr workspace.
- `delete_session --force` deletes only non-live Sessions. A `starting` or `running` Session must be closed first so pane/process cleanup is not bypassed by store deletion. For borrowed `init-session` Sessions, that close is safe because it does not close the borrowed mux resource.
- Deleting a Session with children normally fails. `delete_session --force` may orphan child Sessions by setting their `parent_session_id` to null; it does not cascade-delete children.
- Once a Session is non-live and child handling has succeeded, `delete_session --force` deletes the Session and all related messages where `from_session_id = id OR to_session_id = id`.
- Related-message deletion semantics live in `@asem/ops`, not in FK cascade.
- `@asem/store` exposes scoped transactional primitives such as `deleteSessionScoped`, `deleteRelatedMessagesScoped`, and `withTransaction`; it does not decide when a delete operation should remove related messages.

## Template and runtime design

asem uses command sequence templates, not fixed TypeScript adapters. This is the main product difference from cuekit-style runtime adapters.

Templates split runtime integration into two independent concepts:

1. **mux template** — how to create panes, run commands in panes, send input, attach, and close;
2. **agent template** — how to invoke the agent CLI and deliver the initial prompt.

### Sequence engine

Initial step capabilities:

- `run`
- `write_file`
- `wait_ms`
- `capture` using JSONPath or regex
- `cwd`
- `env`
- `background`
- `timeout_ms` with default timeout and per-step override
- narrow `on_error` policy: `fail` or `ignore` only

MVP excludes loops, conditionals, parallelism, retries, and rollback DSL. Command sequences are startup/control procedures, not workflows. `on_error` must not become hidden branching or rollback logic; operation-level cleanup owns best-effort mux close after create failure.

`run` is shell-command based by default.

Template variables should expose raw and shell-escaped values:

```text
{{message}}
{{message_shell}}
{{cwd}}
{{cwd_shell}}
```

Command strings should use `_shell` variants. Template-generated non-shell files may expose explicit format-specific variables only where needed; for example the builtin zellij layout uses `{{cwd_kdl}}` and `{{launch_script_kdl}}` for quoted KDL string literals.

### Mux template shape

Mux templates expose five command sequences plus an optional structured attach argv template:

```yaml
create: []          # create mux session/window/tab/pane and capture refs
run_in_pane: []     # execute launch script/command in target pane
send: []            # inject text into pane
attach: []          # legacy shell attach hint for humans
attach_command: []  # argv form preferred by CLI/TUI attach runners
close: []           # close pane/session process
refs: {}            # derivable mux refs interpolated from create base vars
```

`refs` records coordinates that are known before the mux `create` sequence runs, such as a native tmux/rmux/zellij session name derived from the asem Session id. Runtime merges `refs` with `create` captures into `mux_ref_json`; if both define the same key, the `create` capture wins because it carries the live mux coordinate.

Initial builtin mux templates:

- `herdr`
- `tmux`
- `rmux`
- `zellij`

Builtin mux lifecycle follows the cuekit-proven model where possible: tmux, rmux, and zellij create one native multiplexer session per asem Session, then attach and close by that native session name. Herdr creates one workspace per asem Session under an explicit `herdr_session`; `send` targets the captured root pane, `attach` focuses the captured workspace/tab, and `close` closes the workspace. CLI/TUI attach prefer `attach_command` argv over shelling an `attach` string.

### Agent template shape

Agent templates contain:

```yaml
command: "... {{model_shell}} {{prompt_shell}} ..."
model_flag: "--model"  # optional; required iff command carries {{model_shell}}
paste_prompt: false
before_paste: []  # optional; only valid when paste_prompt is true
before_agent: []  # optional launch.sh hook lines run before the Agent command
after_agent: []   # optional launch.sh hook lines run after the Agent command exits
```

Prompt handling:

- Always write the prompt to `prompt.md` in the Session dir for audit/debug.
- The agent template decides how the prompt is delivered.
- Agent `command` is a shell command template with a deliberately small prompt placeholder set:
  - `{{prompt_shell}}` — a shell-safe snippet that reads `prompt.md`, such as `"$(cat /path/to/prompt.md)"`; it does not embed the prompt body directly in `launch.sh`.
  - `{{prompt_path_shell}}` — the shell-escaped path to `prompt.md`.
- Unknown `{{...}}` placeholders in Agent `command` are invalid template configuration.
- `paste_prompt: true` starts the Agent without prompt placeholders and then uses the mux `send` sequence to paste the prompt.
- `before_paste` replaces the old `after_start` name; it is a Command Sequence that runs after Agent start and before the prompt paste, and is valid only when `paste_prompt: true`.
- `paste_prompt: true` is mutually exclusive with prompt placeholders in `command`.
- A command with no prompt placeholder and no `paste_prompt` is allowed. In that case the prompt is still saved to `prompt.md`, but asem does not pass it to the Agent unless the command/wrapper reads it itself.
- The previous `prompt_delivery` field is removed; see [ADR 0005](../adr/0005-agent-prompt-delivery-uses-command-templates.md).

Optional model selection (MIK-040):

- `{{model_shell}}` expands to `<model_flag> <model>` when `create_session` receives a `model`, and to the empty string when it is omitted. Both the `model_flag` and the user-supplied model value are shell-escaped, so neither a metacharacter-bearing flag nor a model with spaces/metacharacters can break out of the launch command.
- `model_flag` is one shell-token flag such as `--model` or `-m`.
- `model_flag` and `{{model_shell}}` must appear together. A Template carrying only one of them is `invalid_template`. A Template carrying neither is model-unsupported.
- `{{model_shell}}` is independent of the prompt placeholders, so a `paste_prompt` Agent (e.g. `opencode`) may still support model selection in its startup command.
- Builtins `claude` / `codex` / `pi` / `gemini` / `opencode` declare `model_flag: "--model"`; builtin `kimi` declares `model_flag: "-m"`; builtin `agy` is intentionally model-unsupported. Requesting a model for a model-unsupported Template fails with `invalid_input` before any filesystem, mux, or store side effects — asem never silently launches an Agent without the requested model.
- The launch script also exports `AS_MODEL` (empty when no model was selected).

Agent launch hooks (`before_agent` / `after_agent`):

- They are arrays of literal shell command lines woven into the generated mode-`0600` `launch.sh` around the Agent process, not run by the outer `TemplateRunner`. They share the Agent's `cwd` and exported launch env.
- No `{{...}}` interpolation happens inside hook lines; hooks read launch env vars (below) instead.
- `before_agent` is strict: it runs under the script's `set -euo pipefail`, so the first failing hook aborts before the Agent command starts.
- `after_agent` is best-effort: it runs after the Agent command exits with `set -e` disabled, so every after hook is attempted even if an earlier one fails. The Agent command's exit code is captured into `AS_AGENT_EXIT_CODE` and preserved as the script's final exit code. `after_agent` is not guaranteed under a mux forced kill/close that terminates the pane before the Agent returns control.
- Hook stdout/stderr goes to the same pane as normal shell output.
- These differ from `before_paste`: `before_paste` is a Command Sequence run by the operation outside `launch.sh` after the Agent starts and before a mux prompt paste, while `before_agent` / `after_agent` are literal shell lines inside `launch.sh` around the Agent process itself.
- Empty hooks default to `[]`; generated/materialized `.asem.yaml` omits empty `before_agent` / `after_agent` fields.

Initial builtin agent templates:

- `claude`
- `codex`
- `pi`
- `gemini` / `agy`
- `opencode`
- `kimi`

Exact command flags must be verified during implementation; do not assume every CLI accepts prompt files.

### Agent Profiles

Agent Profiles are explicit prompt-shaping bundles for new Sessions. They are not workflow roles and are applied only when a caller passes `profile` / `--profile`; there is no profile auto-selection or hidden config default in MVP. See [ADR 0007](../adr/0007-agent-profiles-are-explicit-prompt-shaping.md) and [Agent Profiles Design](./agent-profiles-design.md).

Profile sources resolve as `project > user > builtin`:

```text
<worktree_root>/.asem/agents/*.md
~/.asem/agents/*.md
builtin profiles
```

User/project profile files are Markdown with frontmatter. `id` and body instructions are required; `description`, `agent`, and `model` are optional. Source-level duplicate ids are `invalid_config`; a requested unknown profile is `invalid_input`.

When a profile is selected, `create_session` writes an effective `prompt.md` containing profile instructions first and the caller's original prompt second. This same effective prompt is used for normal prompt-file delivery and `paste_prompt` delivery.

The builtin profiles are `context-builder`, `debugger`, `delegate`, `docs-writer`, `oracle`, `planner`, `researcher`, `reviewer`, `scout`, and `worker`. They are instructions-only, use strong prompt contracts inspired by `pi-subagents`, and intentionally exclude workflow-shaped names such as `coordinator`, `parent`, or `pr-finisher`.

### Launch script standard

Use a Session-specific launch script as the standard way to inject env and start the agent.

Reasons:

- Some multiplexers may not support env-aware pane spawning.
- Tokens must not leak through command-line args, pane labels, or shell history.
- Shell escaping is centralized.

Injected env:

```sh
AS_SESSION_ID=...
AS_PARENT_SESSION_ID=...
AS_WORKSPACE_ID=...
AS_WORKTREE_ROOT=...
AS_PROJECT_ROOT=...
AS_SESSION_TOKEN=...
AS_SESSION_DIR=...
AS_PROMPT_PATH=...
AS_SESSION_NAME=...
AS_AGENT=...
AS_MUX=...
AS_MODEL=...
AS_PROFILE=...
AS_PROFILE_SOURCE=...
```

`AS_PROJECT_ROOT` is an optional alias for cwd or worktree root if useful. `AS_SESSION_DIR`, `AS_PROMPT_PATH`, `AS_SESSION_NAME`, `AS_AGENT`, `AS_MUX`, `AS_MODEL`, `AS_PROFILE`, and `AS_PROFILE_SOURCE` are exported so Agent launch hooks (`before_agent` / `after_agent`) can read them. During `after_agent`, the launch script additionally exposes `AS_AGENT_EXIT_CODE`, the Agent command's exit code — this is hook-local process context, not a durable Session outcome. The DB stores only `token_hash`.

## Operation model

CLI and MCP call shared operation handlers. Surface-specific code parses CLI/MCP input, calls the operation, and renders the result.

### Initial operation table

| Operation | CLI surface | MCP tool | Auth | Boundary / location | Main side effect |
|---|---|---|---|---|---|
| Initialize project | `asem init` | — | human local trust | current cwd | creates `.asem.yaml`, updates `.gitignore` |
| Register current Session | `asem init-session` | `init_session` | token generated | Workspace + current cwd location | inserts Session row, sets Workspace current, prints exports |
| Create Session | `asem session create [--repo <alias>]` | `create_session` | human or verified current Session | Workspace + requested cwd/repo location | creates pane, writes files, inserts Session row; `repo` is shared cwd-alias input |
| List Repo Aliases | `asem workspace repo list` | — | human local trust | current Workspace config | reads `.asem.yaml` repo aliases and path existence |
| List Profiles | `asem profile list` | `list_profiles` | human local trust | current Workspace/location | reads builtin/user/project Agent Profile definitions |
| Get Profile | `asem profile get <id>` | `get_profile` | human local trust | current Workspace/location | reads one resolved Agent Profile definition |
| List Sessions | `asem session list` | `list_sessions` | human or verified current Session | Workspace, optional location filters | reads Session rows, may update liveness |
| Get Session | `asem session get` | `get_session` | human or verified current Session | Workspace | reads one Session, may include `attach_hint` and `attach_command` |
| Attach Session | `asem session attach` | — | human local trust | Workspace lookup, target location | attaches to external mux |
| Close Session | `asem session close` | `close_session` | human or verified current Session | Workspace lookup, target location | closes pane/process, sets `closed` |
| Delete Session | `asem session delete` | `delete_session` | human or verified current Session | Workspace lookup | deletes Session and related messages; protects children |
| Send Message | `asem message send` | `send_message` | human or verified current Session | Workspace | inserts Message, best-effort delivery |
| List Messages | `asem message list`, `asem message list --inbox`, `asem message list --undelivered` | `list_messages` | human or verified current Session | Workspace, optional location filters | reads Message rows |
| Wait Message | `asem message wait --to <id> [--from <id>] [--kind message\|report]` | — | human local trust | Workspace | polls Message rows until a match or timeout |
| Report Parent | `asem report parent` | `report_parent` | verified current Session | Workspace | inserts report Message to stored Parent Session |
| Start MCP | `asem mcp` | — | local process | current config | starts stdio MCP server |
| Start TUI | `asem tui` | — | human local trust | Workspace with filters | opens Session cockpit |

MCP intentionally does not expose attach. `get_session` may return legacy `attach_hint` plus structured `attach_command` for human/operator surfaces; CLI/TUI execute the structured argv form when present.

Integration Target setup commands (`asem mcp add --for <target>` and `asem skills add --for <target>`) are CLI-only local toolchain configuration helpers, not shared Session/Message operations. They do not create Sessions, mutate `.asem.yaml`, or appear as AI-facing MCP tools. See [Integration Targets Design](./integration-targets-design.md).

### Current Session registration

Two entry points are required:

1. `asem init-session` registers the already-running current agent/session.
2. `asem session create --root` launches a new root Session with no parent.

`--root` is the preferred clear flag name for MVP. `--as-parent` may remain as an alias only if already implemented or needed for compatibility.

Parent resolution truth table:

| Input | Parent behavior |
|---|---|
| `--parent <session-id>` | Use the explicit parent after verifying the same Workspace. |
| `--root` / `--no-parent` | Create a root Session with `parent_session_id = null`. |
| no parent flag + Workspace current Session exists | Use the Workspace current Session as parent. |
| no parent flag + no Workspace current Session | Return structured `current_session_not_found` with hint to use `--root` or run `asem init-session`. |

`init-session` registers an already-existing pane/workspace. It must record enough Multiplexer coordinates for the registered Session to be deliverable, but it does not own that mux resource. The stored mux ref is therefore marked as borrowed with `asem_mux_owned = "false"`; close/delete flows use that marker to avoid closing the operator's current multiplexer resource before deleting the Session row.

Current Multiplexer registration rules:

| Input / environment | Stored mux behavior |
|---|---|
| Explicit `mux` and `muxRef` input | Use the explicit values after schema validation. This is the strongest signal. |
| Explicit `mux: none` | Register a non-deliverable Session intentionally. Message history still works, but live pane delivery is unavailable. |
| No explicit mux + complete herdr environment (`HERDR_ENV=1`, `HERDR_SESSION`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`) | Auto-register `mux: herdr` with the current herdr pane identifiers and `asem_mux_owned = "false"`. This is safe environment discovery of the pane that already hosts the current process, not workflow inference. |
| Herdr environment is indicated but required identifiers are incomplete | Do not silently fall back to `mux: none`; return a structured, actionable error or warning telling the caller to pass explicit mux data or intentionally choose `mux: none`. |
| No explicit mux and no supported current-mux environment | Use the configured default only if it can produce a valid borrowed mux ref for the current process; otherwise require explicit mux input. |

A Session registered with `mux: none` is valid but non-deliverable. `send_message` / `report_parent` must still persist the Message attempt, then record an actionable `delivery_error` explaining that the target Session has no live delivery Multiplexer and should be re-registered with a deliverable mux such as `herdr` when real-time delivery is desired. Do not expose only an internal template lookup failure such as `mux template not found: none`.

After `init-session`, print exports:

```sh
export AS_SESSION_ID=...
export AS_SESSION_TOKEN=...
export AS_WORKSPACE_ID=...
export AS_WORKTREE_ROOT=...
```

Also write a Workspace current-session file so CLI commands can infer the current Session where appropriate. `session create` does not update this file; it is set by `init-session` and by an explicit current-session switch command.

Current Session resolution order:

1. `AS_SESSION_ID` and `AS_SESSION_TOKEN` from the environment;
2. the Workspace current-session file.

The current-session file path and shape are intentionally not fully locked in this design. The file is under the Workspace root `.asem/` runtime path and must be ignored by Git. When it contains token material, it must be mode `0600`. A safer implementation may split non-secret metadata from raw token material, for example by storing a pointer in `current-session.json` and the raw token under `.asem/tokens/`; if so, update this design before locking the format.

### Create Session flow

`repo` is shared `create_session` input for CLI and MCP. The operation resolves `repo` before side effects: discover the Workspace config that declares `repos`, resolve the alias path relative to that config, reject a missing/non-directory path, require the path to remain under the Workspace root, and use the resolved path as the Session cwd. `repo` and `cwd` are mutually exclusive.

1. Resolve config `.asem.yaml`. For `repo`, this is the alias-declaring Workspace config, not a repo-local override.
2. Resolve `workspace_id` from the resolved config, then resolve Session `cwd` and `worktree_root` from the requested cwd/repo.
3. Resolve parent using the parent-resolution truth table unless `--root` / `--no-parent` is set.
4. Resolve the requested Agent Profile, if any, from project/user/builtin sources.
5. Resolve final Agent and model using `explicit input > selected profile default > config default`, suppressing the profile model default when an explicit Agent differs from the profile Agent default.
6. Validate model support for the final Agent Template before side effects.
7. Create Session dir under `<worktree_root>/.asem/sessions/<id>/`.
8. Write effective `prompt.md` (profile instructions first when a profile is selected, then the original user prompt).
9. Execute mux `create` sequence and capture mux refs.
10. Generate launch script with env and agent command.
11. Execute mux `run_in_pane` sequence to start the launch script.
12. For a `paste_prompt` Agent Template only: run the Agent's `before_paste` sequence, then the mux `send` sequence with `prompt.md`'s contents as the message to paste the effective prompt into the now-running Agent.
13. Register Session in SQLite only after successful start (and successful paste, when applicable).
14. If any step fails before DB registration, return a structured error, include the temp/session log path, and attempt mux cleanup.

This ordering avoids stale failed Session rows.

### Message formatting

Store both raw and sent text:

- `body` — user-provided body;
- `formatted_body` — exact text sent to mux.

Delivery wrapper examples:

```text
[asem message from parent]
<message body>
```

```text
[asem report from reviewer-1]
<report body>
```

## Auth and local trust model

Agent-originated operations require Session token verification.

- `from_session_id` must match the verified token.
- DB stores `token_hash`, never raw token.
- Raw token is injected through env or mode-`0600` files.

Human/operator CLI and TUI operations operate under local trust. TUI is an operator surface and may send/close/delete without Session token, guarded by confirmation for destructive operations. TUI mutation effects mark themselves operator-originated so a stale or sibling-worktree current-session pointer cannot block an explicit human close/delete action.

`send_message` decides a Message's source by resolving the current Session for the Workspace: an agent-originated call verifies that Session's token and is attributed to it; a human local-trust CLI call may use the Workspace current Session when present; an explicit operator-originated call is recorded with no Session source attribution (`from_session_id = null`, `[asem message]` header). The TUI is inherently the human operator, so it marks its send operator-originated (`OpContext.origin = "operator"`) to force the operator path: it never adopts the Workspace current Session. The marker lives in the surface-built context, not the `send_message` input schema, so MCP/CLI input cannot set it. `report_parent` always acts as the verified current Session, follows that Session's stored `parent_session_id`, and never carries an operator origin. See [ADR 0003](../adr/0003-tui-operator-message-attribution.md).

## Error semantics

Use structured errors for recoverable operational failures. Throw only for defects or infrastructure corruption.

Important MVP errors:

- `config_not_found`
- `invalid_config`
- `invalid_template`
- `workspace_mismatch`
- `session_not_found`
- `session_name_conflict`
- `parent_session_not_found`
- `invalid_session_token`
- `mux_template_not_found`
- `agent_template_not_found`
- `sequence_step_failed`
- `capture_failed`
- `timeout`
- `message_delivery_failed`

Create failures must not leave DB rows. Message delivery failures do leave Message rows with `delivery_error`.

A malformed project-local template (a `.asem.yaml` `mux`/`agent` definition that fails the schema) is a recoverable local configuration defect, not a defect in asem: the ops boundary converts the schema error into `invalid_template` (with the template `kind`, `name`, and schema issue messages, never raw values) instead of letting it escape as an internal error. A *missing* template name is still `mux_template_not_found` / `agent_template_not_found`, and the best-effort delivery/attach paths keep their existing missing-template fallback. Template parsing happens before side effects where applicable, so an invalid template blocks a create/close/send before any pane control or Message row.

## Package architecture

Initial monorepo packages:

| Package | Responsibility | External I/O |
|---|---|---|
| `@asem/core` | domain types, schemas, Workspace/location types, operation input/output contracts, port interfaces, pure shell escaping helper, token hash/verify | none |
| `@asem/runtime` | template registry, template interpolation, sequence engine, capture handling, fake runner contract; uses core shell escaping helper | injected command/file/clock/logger ports |
| `@asem/profiles` | builtin Agent Profile definitions, user/project profile discovery, Markdown/frontmatter parsing, source precedence, profile resolution, effective prompt rendering | filesystem through injected/rooted inputs |
| `@asem/store` | SQLite migrations, row mapping, Workspace-scoped Session/Message CRUD, transaction primitives, location filters | SQLite |
| `@asem/ops` | shared operation handlers over injected ports, auth/Workspace checks, repo alias resolution, create/send/close/delete/list semantics | injected ports only |
| `@asem/cli` | installed `asem` binary, command parsing, human rendering, starts MCP/TUI | shell/stdout/stderr |
| `@asem/mcp` | stdio MCP server, MCP tool projection over shared operations | MCP stdio |
| `@asem/tui` | OpenTUI Session cockpit and TUI view models | terminal UI / attach command |

Recommended dependency direction:

```text
@asem/cli ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           ├─> @asem/runtime
           ├─> @asem/mcp
           └─> @asem/tui

@asem/mcp ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           └─> @asem/runtime

@asem/tui ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           └─> @asem/runtime

@asem/ops ─┬─> @asem/core
           └─> @asem/runtime

@asem/runtime ─> @asem/core
@asem/store   ─> @asem/core
@asem/core    ─> no project package dependencies
```

`@asem/ops` depends on `@asem/runtime` for the pure template schema, the
`SequenceEngine`, and the redactor. This does not import concrete I/O: the
runtime executes only through the injected `TemplateRunner` port, so create/
send/close operations reuse one sequence engine instead of re-implementing it.

Operation handlers live in `@asem/ops` by default. `@asem/core` owns operation contracts and port interfaces only. `@asem/ops` must use injected deps for store, runtime, filesystem, config, current-session resolution, liveness probing, logging, time, ids, and token generation. CLI, MCP, and TUI must not duplicate semantic logic.

## TUI design

Package:

```text
@asem/tui
```

Command:

```sh
asem tui
```

Implementation choice: a renderer-agnostic cockpit core behind a `CockpitHost`
seam, with OpenTUI/React as the primary human renderer and the minimal ANSI host
kept as a fallback/test host where useful. The workspace-live refresh refinement
is captured in [`asem-tui-workspace-live-cockpit-design.md`](./asem-tui-workspace-live-cockpit-design.md).

The cockpit is split so the renderer stays replaceable and the behavior stays
testable without a TTY (implementation principle 13):

- pure view-model (`createCockpitState` / `dispatchCockpit` / selectors) — state,
  navigation, tabs, ephemeral badges, send/confirm flow;
- pure render projection (`renderCockpitView` → `CockpitView`) — the "component"
  layer the host paints, asserted directly in tests instead of via terminal
  snapshots;
- pure key mapping (`keyToAction`) — modal-aware keybindings including the send
  modal's multiline editing;
- an app/controller (`CockpitApp`) that sequences the reducer, carries out the
  single emitted `@asem/ops` effect, and drives the host;
- the `CockpitHost` seam: the only TTY-touching part. The built-in
  `AnsiCockpitHost` (no rendering dependency) implements it now; a richer
  renderer such as OpenTUI can replace it without changing any tested logic.

Default tests drive the app through a scripted fake host and the `@asem/ops`
in-memory fakes — no real terminal and no real multiplexer. Attach is modeled
through the host seam (`host.attach`), so a real mux is optional and skipped by
default.

### TUI purpose

TUI is a human Session cockpit. It is not a Session launcher in MVP.

Initial TUI supports:

- inspect Sessions;
- inspect detail/messages/context;
- send Message to selected Session;
- attach to selected Session;
- close Session;
- delete Session;
- refresh/filter;
- workspace-wide live refresh with in-memory activity rows.

Initial TUI excludes:

- creating Sessions;
- `report_parent`;
- live transcript embedding;
- durable unread state.

### Layout

Chosen layout: 2-pane + tabbed detail, with centered textarea send modal.

```text
┌ Sessions ────────────────┬ [Messages] [Detail] [Context] ───────────────────────┐
│ scope: worktree          │ selected tab content                                  │
│ filter: running          │                                                       │
│ ▾ parent                 │ Messages is default tab                               │
│   ├─ reviewer-1 ● +2     │                                                       │
│   └─ helper-1    !       │                                                       │
└──────────────────────────┴───────────────────────────────────────────────────────┘
[a] attach [s] send [c] close [D] delete [r] refresh [f] filter [Tab] switch [?] help [q] quit
```

Status symbols:

```text
… starting
● running
○ exited
! missing
× closed
```

Messages tab row format:

```text
10:05 parent → reviewer-1 [message] body...
10:09 helper-1 → reviewer-1 [message] body... ! undelivered
```

Messages are chronological ascending for the selected Session-related messages.

### Detail tabs

Messages:

- default tab;
- selected Session-related messages;
- delivery error marker when present.

Detail:

- `id`
- `name`
- `status`
- `agent`
- `mux`
- `parent`
- `cwd`
- `worktree_root`
- `session_dir`
- `created_at`
- `updated_at`
- `closed_at`
- `attach_hint`

Context:

- `workspace_id`
- `worktree_root`
- `cwd`
- config path
- default mux
- default agent
- selected Session mux ref summary

### TUI behavior

- Auto refresh every 3 seconds while the cockpit is idle.
- Manual refresh with `r`.
- Auto refresh pauses while a send, confirm, help, or error modal is open.
- Liveness checks may update `running` Sessions to `exited` or `missing`.
- New-message badges are ephemeral, based on TUI start / last observed baseline.
- `a` runs the attach command and leaves TUI temporarily; on return, TUI refreshes.
- `s` opens a centered multi-line textarea modal.
- Enter inserts newline, Ctrl+Enter sends, Esc cancels.
- Close and delete require confirmation dialogs.
- Operator-initiated send/close/delete failures open a dismissible error modal. Refresh and auto-refresh failures stay as non-modal `CockpitNotice` feedback so a transient or repeated refresh error does not reopen a modal every interval.
- OpenTUI renders `CockpitNotice` feedback as a single toast in the top-right corner; ANSI/string fallback rendering may show the same notice as a footer line.
- Operation logs must not write JSON/prose lines directly into the terminal while the TUI renderer owns the screen; operator-facing errors and status are rendered in-band through the cockpit view.

## Testing strategy

Use fake command runners as the primary test harness.

Test categories:

- config discovery and parsing;
- scope resolution for Git and non-Git directories;
- token hash and verification;
- template variable interpolation and shell escaping;
- sequence execution order;
- JSONPath and regex capture;
- timeout behavior;
- launch script generation;
- file mode behavior for token-bearing files;
- SQLite migrations, constraints, indexes, and row mapping;
- explicit related-message cleanup on delete;
- CLI handler behavior;
- MCP handler behavior;
- TUI view-model behavior;
- create failure cleanup and no stale DB rows;
- message delivery success/failure persistence.

Fake runner contract:

- record ordered command traces;
- script stdout/stderr/exit code per step;
- assert `cwd`, `env`, timeout, background flag, and shell-escaped variables;
- support virtual time for `wait_ms` and timeout tests;
- provide capture fixtures for regex and JSONPath;
- return deterministic background handles;
- inject failure, timeout, and capture failure;
- verify logs and structured errors redact token material.

Operation test matrix:

| Operation family | Required fake deps | Must test |
|---|---|---|
| `init` / config | `FileSystem`, `ConfigLoader`, `ScopeResolver` | config creation, gitignore rules, missing/invalid config errors |
| `init_session` | `Store`, `FileSystem`, `TokenGenerator`, `Clock`, `IdGenerator` | token hash only in DB, current-session file mode/ignore coverage, herdr-env borrowed mux auto-registration, explicit `mux: none` remains non-deliverable |
| `create_session` | `Store`, `TemplateRegistry`, `TemplateRunner`, `FileSystem`, `CurrentSessionResolver`, `TokenGenerator`, `Logger` | sequence order, parent resolution, DB insert only after success, cleanup on failure, log path in error |
| `send_message` / `report_parent` | `Store`, `TemplateRunner`, `CurrentSessionResolver`, `Clock` | auth/Workspace checks, formatted body, delivered_at vs delivery_error persistence, actionable non-deliverable `mux: none` failure |
| `list/get` | `Store`, `ScopeResolver`, `LivenessProbe` | Workspace default reads, optional location filters, optional liveness update, no work-outcome inference |
| `close/delete` | `Store`, `TemplateRunner`, `Clock` | Workspace lookup, close best-effort behavior, child protection/orphaning, operation-owned related-message cleanup |
| CLI/MCP projection | fake `@asem/ops` result or fully faked deps | surface parsing/rendering only, no duplicated semantics |
| TUI view-model | fake `@asem/ops` and store snapshots | selection, tabs, ephemeral badges, confirmations, no durable unread state |

Real mux integration tests:

- herdr, tmux, rmux, and zellij tests are optional;
- skip when the binary is unavailable;
- default CI must not require real multiplexers.

### MVP smoke checks

A single fake-runtime smoke suite proves the implemented slices work together
before the MVP is called ready. It lives in the integrator package
(`packages/cli/test/mvp-smoke.test.ts`) because `@asem/cli` depends on every
surface, and it is deliberately cross-package: one shared in-memory Store and
FileSystem are driven through the shared `@asem/ops` spine and then projected
through MCP, the TUI cockpit, and the CLI.

The flow walks the operation table end to end — `init` → `init-session` →
`create-session` → `list`/`get` → `send-message` → `report-parent` →
`message-list` → `close` → `delete` — then exercises MCP tool projection (the nine
agreed tools, no attach), the TUI view-model/UI basics (tabs, keybar, Session
rows, a scripted send), and a CLI projection. It also asserts the security/state
invariants directly: token-bearing files (`.asem/tokens/<id>.token`, the launch
script) are mode `0600` under the ignored runtime paths, the current-session
pointer excludes the raw token, and no raw token ever reaches the log stream
(secret redaction). It uses only fakes — no real multiplexer or agent CLI.

A companion docs scan (`packages/cli/test/docs-links.test.ts`) keeps the durable
docs honest: every relative Markdown link must resolve and no placeholder markers
may ship.

The opt-in real-mux/agent checks are separate and off by default: the
`@asem/runtime` integration suites run only under `ASEM_MUX_INTEGRATION=1` /
`ASEM_AGENT_INTEGRATION=1` and additionally skip per binary when it is absent.

## MVP implementation order

1. **Monorepo scaffold**
   - Bun + TypeScript.
   - Packages: `core`, `runtime`, `store`, `ops`, `cli`, `mcp`, `tui`.

2. **Core schemas, ports, and domain helpers**
   - Session schema.
   - Message schema.
   - Config schema.
   - Workspace and location resolution.
   - Token hashing/verification.
   - Port interfaces for store, runtime, filesystem, config loading, current-session resolution, liveness probing, logging, time, ids, and token generation.
   - Shell escaping.

3. **Runtime + fake runner**
   - template registry;
   - sequence execution;
   - capture JSONPath/regex;
   - timeouts and virtual time contract;
   - fake runner command trace and failure injection.

4. **Store**
   - SQLite init/migrations.
   - Sessions/Messages CRUD.
   - Workspace transaction primitives and location filters for delete cleanup and views.
   - Indexes and constraints.

5. **Ops baseline**
   - shared operation handlers over injected deps;
   - auth and Workspace checks;
   - list/get/init/message-list operations first.

6. **CLI baseline**
   - `asem init`.
   - `asem init-session`.
   - `asem session list/get`.
   - `asem message list`.

7. **Mux templates**
   - herdr, tmux, rmux, zellij builtin templates;
   - fake-runner tests first;
   - optional real integration tests.

8. **Agent templates**
   - claude, codex, pi, gemini/agy, opencode;
   - verify actual CLI prompt behavior before locking commands.

9. **Create/send/close/delete operations**
   - launch script standard;
   - env injection;
   - DB registration only after successful start;
   - best-effort Message delivery.

10. **MCP stdio**
    - expose agreed tools using shared handlers;
    - no MCP attach.

11. **TUI**
    - OpenTUI in `@asem/tui`;
    - 2-pane + right tabs + bottom keybar;
    - no creation UI in MVP.

## Deferred questions

- Exact builtin commands and flags for each agent CLI.
- Whether the proposed `.asem.yaml` discovery rule should stop at the Git root
  instead of continuing to filesystem root.
- Exact current-session file path and JSON shape, if the proposed
  `.asem/current-session.json` shape changes during implementation.
- Whether `AS_PROJECT_ROOT` should mean cwd, worktree root, or be omitted until
  needed.
- Whether to add `asem config validate` after templates stabilize.
- Whether template files should support includes/imports after MVP.
- Whether TUI should later support creation, live transcript embedding, or durable unread state.

## Design summary

asem should start as a small, local-first Session substrate:

- one durable Session table;
- one durable Message table;
- one Workspace boundary with cwd / Worktree Root as Session location metadata;
- command sequence templates for runtime control;
- shared operations projected into CLI and MCP;
- a human TUI cockpit that operates on Sessions, not tasks.

The strongest design constraint is negative: asem must stay out of workflow
interpretation. It should help agents and humans find, attach to, and talk to
live local Sessions, while leaving task meaning and outcome judgment to the
humans or agents using it.
