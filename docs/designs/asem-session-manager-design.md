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
3. list Sessions in the current scope;
4. send a Message to another Session;
5. report to a parent Session;
6. view Message history, including self-addressed history;
7. attach to a Session's multiplexer pane from the CLI/TUI;
8. close or delete Sessions.

## Goals

- Manage live local agent CLI Sessions running inside terminal multiplexers.
- Keep normal visibility and messaging isolated by `workspace_id + worktree_root`.
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

A Message is a durable SQLite record plus a best-effort delivery attempt into the target Session's multiplexer pane.

```ts
type MessageKind = "message" | "report";
```

`report_parent` is implemented as `Message(kind="report")` addressed to the current Session's `parent_session_id`.

### Report

A Report is just a Message from a child Session to its parent Session. It does not close the Session and does not mean the work is complete.

### Workspace, Worktree Root, Effective Scope

- `workspace_id` is a logical grouping id from `.asem.yaml`.
- `worktree_root` is the realpathed Git worktree root, or cwd realpath outside Git.
- Effective normal scope is `workspace_id + worktree_root`.

Normal Session visibility, Message sending, and parent-child relationships require both fields to match.

### Inbox

There is no formal inbox protocol in the MVP. `list_messages --inbox` and MCP `list_messages({ inbox: true })` filter Message history to rows addressed to the current Session. This is self-addressed history, not durable unread state.

### Role

There is no `role` field in MVP. Session specialization should be expressed through Session names, prompts, parent relation, and agent templates.

## Scope resolution

Effective scope is resolved before all normal operations that read or mutate Sessions or Messages.

1. Load `.asem.yaml` and read `workspace.id`.
2. Resolve `worktree_root`:
   1. run `git rev-parse --show-toplevel` if available;
   2. realpath the result;
   3. if Git lookup fails, realpath cwd.
3. Use `(workspace_id, worktree_root)` as the default boundary.

TUI has an explicit workspace-wide mode:

```sh
asem tui --scope worktree   # default
asem tui --scope workspace
```

- `worktree` shows only current `workspace_id + worktree_root`.
- `workspace` shows all Sessions with the same `workspace_id`, grouped by `worktree_root`.
- In `workspace` scope, TUI operations on other worktrees are allowed because the human explicitly chose a workspace-wide view.
- There is no `--scope all` in MVP.

## Config design

Config file:

```text
.asem.yaml
```

Initial shape:

```yaml
workspace:
  id: my-workspace

mux:
  default: herdr
  templates: {}

agent:
  default: claude
  templates: {}
```

Rules:

- `workspace.id` is required after `asem init`.
- Builtin templates are available even when project-local `templates` is empty.
- Project-local templates are trusted like local code.
- Multiple worktrees may share the same `workspace.id`, but normal operations remain worktree-isolated.
- No `config validate` command in MVP.

### Config discovery

The handoff fixes the config filename and schema but not the exact search behavior. MVP should treat this as a proposed default until implementation validates it:

1. Start at cwd.
2. Walk upward until a `.asem.yaml` is found.
3. Stop at filesystem root.
4. If missing for commands that require project config, return a structured `config_not_found` error suggesting `asem init`.

`asem init` creates `.asem.yaml` in the current worktree root by default.

## Persistence model

### Global database

Use one global SQLite database:

```text
~/.asem/state.db
```

The global DB enables discovery across local shells and agent processes while still enforcing operation-level scope filters.

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
  parent_session_id text,
  status text not null,
  mux_ref_json text not null,
  session_dir text not null,
  token_hash text not null,
  created_at text not null,
  updated_at text not null,
  closed_at text
);

create unique index sessions_scope_name_unique
  on sessions(workspace_id, worktree_root, name);

create index idx_sessions_workspace_status
  on sessions(workspace_id, worktree_root, status);
```

Notes:

- `mux_ref_json` stores multiplexer-specific coordinates such as herdr workspace/tab/pane or tmux session/window/pane.
- `parent_session_id` must point to a Session in the same effective scope for normal operations.
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
  on messages(workspace_id, worktree_root, created_at desc);

create index idx_messages_to_created
  on messages(to_session_id, created_at desc);

create index idx_messages_delivery_error
  on messages(workspace_id, worktree_root, delivery_error);
```

Message guarantees:

- Persist the Message before or with the delivery result.
- Delivery is best-effort.
- If target pane exists and delivery command succeeds, set `delivered_at`.
- If delivery fails, set `delivery_error`.
- No ack, read receipt, or durable unread state.

Deletion rule:

- `delete_session --force` deletes the Session and all related messages where `from_session_id = id OR to_session_id = id`.
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

Command strings should use `_shell` variants.

### Mux template shape

Mux templates expose five sequences:

```yaml
create: []       # create mux session/window/tab/pane and capture pane refs
run_in_pane: []  # execute launch script/command in target pane
send: []         # inject text into pane
attach: []       # attach command for humans/CLI/TUI
close: []        # close pane/session process
```

Initial builtin mux templates:

- `herdr`
- `tmux`
- `zellij`

### Agent template shape

Agent templates contain:

```yaml
command: "..."
prompt_delivery: "arg" | "stdin" | "file" | "paste"
after_start: [] # optional, mainly for paste flow
```

Prompt handling:

- Always write the prompt to `prompt.md` in the Session dir for audit/debug.
- The agent template decides how the prompt is delivered.

Prompt delivery modes:

- `arg` — pass prompt as a CLI argument.
- `stdin` — pipe prompt to the process.
- `file` — pass prompt file path if supported.
- `paste` — start the agent, then use mux `send` to paste prompt.

Initial builtin agent templates:

- `claude`
- `codex`
- `pi`
- `gemini` / `agy`
- `opencode`

Exact command flags must be verified during implementation; do not assume every CLI accepts prompt files.

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
```

`AS_PROJECT_ROOT` is an optional alias for cwd or worktree root if useful. The DB stores only `token_hash`.

## Operation model

CLI and MCP call shared operation handlers. Surface-specific code parses CLI/MCP input, calls the operation, and renders the result.

### Initial operation table

| Operation | CLI surface | MCP tool | Auth | Scope | Main side effect |
|---|---|---|---|---|---|
| Initialize project | `asem init` | — | human local trust | current worktree | creates `.asem.yaml`, updates `.gitignore` |
| Register current Session | `asem init-session` | `init_session` | token generated | effective scope | inserts Session row, prints exports |
| Create Session | `asem session create` | `create_session` | human or verified current Session | effective scope | creates pane, writes files, inserts Session row |
| List Sessions | `asem session list` | `list_sessions` | human or verified current Session | effective scope | reads Session rows, may update liveness |
| Get Session | `asem session get` | `get_session` | human or verified current Session | effective scope | reads one Session, may include `attach_hint` |
| Attach Session | `asem session attach` | — | human local trust | effective scope | attaches to external mux |
| Close Session | `asem session close` | `close_session` | human or verified current Session | effective scope | closes pane/process, sets `closed` |
| Delete Session | `asem session delete` | `delete_session` | human or verified current Session | effective scope | deletes Session and related messages |
| Send Message | `asem message send` | `send_message` | human or verified current Session | effective scope | inserts Message, best-effort delivery |
| List Messages | `asem message list`, `asem message list --inbox`, `asem message list --undelivered` | `list_messages` | human or verified current Session | effective scope | reads Message rows |
| Report Parent | `asem report parent` | `report_parent` | verified current Session | effective scope | inserts report Message to parent |
| Start MCP | `asem mcp` | — | local process | current config | starts stdio MCP server |
| Start TUI | `asem tui` | — | human local trust | worktree/workspace | opens Session cockpit |

MCP intentionally does not expose attach. `get_session` may return `attach_hint` for human/operator use.

### Current Session registration

Two entry points are required:

1. `asem init-session` registers the already-running current agent/session.
2. `asem session create --root` launches a new root Session with no parent.

`--root` is the preferred clear flag name for MVP. `--as-parent` may remain as an alias only if already implemented or needed for compatibility.

Parent resolution truth table:

| Input | Parent behavior |
|---|---|
| `--parent <session-id>` | Use the explicit parent after verifying same effective scope. |
| `--root` / `--no-parent` | Create a root Session with `parent_session_id = null`. |
| no parent flag + current Session exists | Use current Session as parent. |
| no parent flag + no current Session | Return structured `current_session_not_found` with hint to use `--root` or run `asem init-session`. |

`init-session` requires an explicit mux reference if the Session should be deliverable. It should not rely only on auto-detection.

After `init-session`, print exports:

```sh
export AS_SESSION_ID=...
export AS_SESSION_TOKEN=...
export AS_WORKSPACE_ID=...
export AS_WORKTREE_ROOT=...
```

Also write a project-local current-session file so CLI commands can infer current Session where appropriate.

Current-session file path and shape are intentionally not fully locked in the handoff. A conservative proposed MVP shape is:

```text
<worktree_root>/.asem/current-session.json
```

with mode `0600` when it contains token material. This path is covered by the `.gitignore` runtime rule above. A safer implementation may split non-secret metadata from raw token material, for example by storing a pointer in `current-session.json` and the raw token under `.asem/tokens/`; if so, update this design before locking the format.

### Create Session flow

1. Resolve config `.asem.yaml`.
2. Resolve `workspace_id` and `worktree_root`.
3. Resolve parent using the parent-resolution truth table unless `--root` / `--no-parent` is set.
4. Create Session dir under `.asem/sessions/<id>/`.
5. Write `prompt.md`.
6. Execute mux `create` sequence and capture mux refs.
7. Generate launch script with env and agent command.
8. Execute mux `run_in_pane` sequence to start the launch script.
9. Register Session in SQLite only after successful start.
10. If any step fails before DB registration, return a structured error, include the temp/session log path, and attempt mux cleanup.

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

Human/operator CLI and TUI operations operate under local trust. TUI is an operator surface and may send/close/delete without Session token, guarded by confirmation for destructive operations.

## Error semantics

Use structured errors for recoverable operational failures. Throw only for defects or infrastructure corruption.

Important MVP errors:

- `config_not_found`
- `invalid_config`
- `scope_mismatch`
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

## Package architecture

Initial monorepo packages:

| Package | Responsibility | External I/O |
|---|---|---|
| `@asem/core` | domain types, schemas, scope types, operation input/output contracts, port interfaces, pure shell escaping helper, token hash/verify | none |
| `@asem/runtime` | template registry, template interpolation, sequence engine, capture handling, fake runner contract; uses core shell escaping helper | injected command/file/clock/logger ports |
| `@asem/store` | SQLite migrations, row mapping, Session/Message CRUD, scoped transaction primitives | SQLite |
| `@asem/ops` | shared operation handlers over injected ports, auth/scope checks, create/send/close/delete/list semantics | injected ports only |
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

@asem/ops     ─> @asem/core
@asem/runtime ─> @asem/core
@asem/store   ─> @asem/core
@asem/core    ─> no project package dependencies
```

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

Implementation choice: OpenTUI.

### TUI purpose

TUI is a human Session cockpit. It is not a Session launcher in MVP.

Initial TUI supports:

- inspect Sessions;
- inspect detail/messages/context;
- send Message to selected Session;
- attach to selected Session;
- close Session;
- delete Session;
- refresh/filter.

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

- Auto refresh every 3-5 seconds.
- Manual refresh with `r`.
- Liveness checks may update `running` Sessions to `exited` or `missing`.
- New-message badges are ephemeral, based on TUI start / last observed baseline.
- `a` runs the attach command and leaves TUI temporarily; on return, TUI refreshes.
- `s` opens a centered multi-line textarea modal.
- Enter inserts newline, Ctrl+Enter sends, Esc cancels.
- Close and delete require confirmation dialogs.

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
| `init_session` | `Store`, `FileSystem`, `TokenGenerator`, `Clock`, `IdGenerator` | token hash only in DB, current-session file mode/ignore coverage, explicit mux ref requirement |
| `create_session` | `Store`, `TemplateRegistry`, `TemplateRunner`, `FileSystem`, `CurrentSessionResolver`, `TokenGenerator`, `Logger` | sequence order, parent resolution, DB insert only after success, cleanup on failure, log path in error |
| `send_message` / `report_parent` | `Store`, `TemplateRunner`, `CurrentSessionResolver`, `Clock` | auth/scope checks, formatted body, delivered_at vs delivery_error persistence |
| `list/get` | `Store`, `ScopeResolver`, `LivenessProbe` | default scope filters, optional liveness update, no work-outcome inference |
| `close/delete` | `Store`, `TemplateRunner`, `Clock` | scoped lookup, close best-effort behavior, operation-owned related-message cleanup |
| CLI/MCP projection | fake `@asem/ops` result or fully faked deps | surface parsing/rendering only, no duplicated semantics |
| TUI view-model | fake `@asem/ops` and store snapshots | selection, tabs, ephemeral badges, confirmations, no durable unread state |

Real mux integration tests:

- herdr, tmux, and zellij tests are optional;
- skip when the binary is unavailable;
- default CI must not require real multiplexers.

## MVP implementation order

1. **Monorepo scaffold**
   - Bun + TypeScript.
   - Packages: `core`, `runtime`, `store`, `ops`, `cli`, `mcp`, `tui`.

2. **Core schemas, ports, and domain helpers**
   - Session schema.
   - Message schema.
   - Config schema.
   - Scope resolution.
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
   - Scoped transaction primitives for delete cleanup.
   - Indexes and constraints.

5. **Ops baseline**
   - shared operation handlers over injected deps;
   - auth and scope checks;
   - list/get/init/message-list operations first.

6. **CLI baseline**
   - `asem init`.
   - `asem init-session`.
   - `asem session list/get`.
   - `asem message list`.

7. **Mux templates**
   - herdr, tmux, zellij builtin templates;
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
- Whether the proposed `.asem.yaml` discovery rule should stop at the Git root instead of continuing to filesystem root.
- Exact current-session file path and JSON shape, if the proposed `.asem/current-session.json` shape changes during implementation.
- Whether `AS_PROJECT_ROOT` should mean cwd, worktree root, or be omitted until needed.
- Whether to add `asem config validate` after templates stabilize.
- Whether template files should support includes/imports after MVP.
- Whether TUI should later support creation, live transcript embedding, or durable unread state.

## Design summary

asem should start as a small, local-first Session substrate:

- one durable Session table;
- one durable Message table;
- one effective scope boundary;
- command sequence templates for runtime control;
- shared operations projected into CLI and MCP;
- a human TUI cockpit that operates on Sessions, not tasks.

The strongest design constraint is negative: asem must stay out of workflow interpretation. It should help agents and humans find, attach to, and talk to live local Sessions, while leaving task meaning and outcome judgment to the humans or agents using it.
