# HANDOFF: asem — Agent Session Manager

## Purpose

This handoff captures the agreed design for **asem**, a new project separate from cuekit.

asem is a local **agent session manager**. It provides one CLI and one MCP surface for launching agent CLI sessions inside terminal multiplexers, registering those sessions in SQLite, and letting sessions exchange messages within a scoped workspace/worktree boundary.

This is **not** a task manager, workflow engine, team orchestrator, kanban system, strategy runner, or result normalizer.

## Suggested skills for the next agent

- `grill-with-docs` — continue refining language and keep `CONTEXT.md` current.
- `brainstorming` — use before changing behavior or introducing new major concepts.
- `writing-plans` — create the implementation plan from this handoff.
- `test-driven-development` / `tdd` — implement the sequence engine, store, and CLI handlers test-first.
- `lsp-navigation` / `ast-grep` — use when coding the TypeScript monorepo.
- `design-deck` — use again if TUI layout decisions need visual comparison.

## Core product statement

asem lets a local operator or agent:

1. register the current agent process as a Session;
2. launch new agent Sessions through a configured multiplexer and agent template;
3. list Sessions in the current scope;
4. send messages to another Session;
5. report to the parent Session;
6. view message history / self-addressed message history;
7. attach to a Session's multiplexer pane from the CLI/TUI;
8. close or delete Sessions.

The same semantic operations should back CLI and MCP. CLI and MCP may expose different command shapes, but they must call shared operation handlers and schemas.

## Final naming decisions

- Project / CLI name: **asem**.
- Config file: **`.asem.yaml`**.
- Project-local generated files: **`.asem/sessions/<session_id>/`**.
- Main resource: **Session**.
- Communication record: **Message**.
- Scope boundary: **workspace_id + worktree_root**.

## Explicit non-goals

asem must avoid drifting back into cuekit-like task orchestration.

Do not add these to the core MVP:

- task lifecycle states such as completed/failed/blocked;
- task events or event streams;
- team strategies, roles, positions, coordinators, or workflow scripts;
- result normalization;
- success/failure interpretation;
- automatic scheduling, auto-wake, or worker pools;
- worktree creation or git branch management;
- artifact management;
- durable read/unread semantics.

## Domain decisions

### Session

A Session is one agent CLI process running in a multiplexer pane, registered in SQLite. A Session can have a parent Session. Parent-child relationships may be arbitrarily deep.

Session state is **process/connection state only**:

```ts
type SessionStatus =
  | "starting"
  | "running"
  | "exited"
  | "missing"
  | "closed";
```

Session status must not represent work outcome.

### Workspace and worktree isolation

Earlier design used only `workspace.id` as the visibility/message boundary. This was rejected because worktrees are intended to isolate work.

Final decision:

- `.asem.yaml` provides `workspace.id`.
- asem resolves `worktree_root` as:
  1. `git rev-parse --show-toplevel`, realpathed, if available;
  2. otherwise the realpath of cwd.
- Normal Session visibility, message sending, and parent-child relationships require **both** `workspace_id` and `worktree_root` to match.
- This prevents accidental cross-worktree messaging even when multiple worktrees share the same logical workspace id.

TUI has a special `--scope workspace` mode that can display and operate across worktrees sharing the same `workspace_id`. Default TUI scope remains `worktree`.

### Message

A Message is a durable SQLite record plus a best-effort delivery attempt into the target Session's multiplexer pane.

Message guarantees:

- Always persisted before/with delivery result.
- Delivery is best-effort.
- If target pane exists and delivery command succeeds, `delivered_at` is set.
- If delivery fails, `delivery_error` is set.
- There is no ack, read receipt, or durable unread state.

Kinds:

```ts
type MessageKind = "message" | "report";
```

`report_parent` is implemented as `Message(kind="report")` addressed to the current Session's `parent_session_id`.

### Inbox

There is no formal inbox protocol. However, `list_messages --inbox` / MCP `list_messages({ inbox: true })` filters Message history to messages addressed to the current Session.

Important: this is a self-addressed history filter, not a durable unread inbox.

### Role

No `role` field in MVP.

Reason: role/position concepts tend to grow into workflow semantics. Session identity should be `name`, `agent`, parent relation, and scope.

## Storage design

Use a global SQLite database:

```text
~/.asem/state.db
```

Use project-local session directories:

```text
<worktree_root>/.asem/sessions/<session_id>/
```

`asem init` should add this to `.gitignore`:

```gitignore
.asem/sessions/
```

Raw Session tokens, prompt files, launch scripts, and run logs live in the session directory. Token-bearing files must be mode `0600`. The DB stores only token hashes.

### `sessions` table

Initial columns:

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
```

Recommended constraints / indexes:

```sql
create unique index sessions_scope_name_unique
  on sessions(workspace_id, worktree_root, name);

create index idx_sessions_workspace_status
  on sessions(workspace_id, worktree_root, status);
```

Notes:

- `mux_ref_json` stores multiplexer-specific coordinates, e.g. herdr session/workspace/tab/pane or tmux session/window/pane.
- `parent_session_id` must point to a Session in the same `workspace_id + worktree_root` scope for normal operations.
- No `role`, no `metadata_json` in MVP.

### `messages` table

Initial columns:

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
```

Recommended indexes:

```sql
create index idx_messages_workspace_created
  on messages(workspace_id, worktree_root, created_at desc);

create index idx_messages_to_created
  on messages(to_session_id, created_at desc);

create index idx_messages_delivery_error
  on messages(workspace_id, worktree_root, delivery_error);
```

Deletion decision:

- `delete_session --force` deletes the Session and all related messages where `from_session_id = id OR to_session_id = id`.
- Implement related-message deletion explicitly in the operation handler, not via FK cascade.

## Config design

Config file name:

```text
.asem.yaml
```

Initial schema shape:

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

- `workspace.id` is a logical grouping id.
- Effective normal scope is `workspace.id + worktree_root`.
- Multiple worktrees may share `workspace.id`, but normal CLI/MCP operations remain worktree-isolated.
- Builtin templates are available even if `templates` is empty.
- Project-local templates are trusted like local code.
- No `config validate` command in MVP; defer it.

## Template / runtime design

Core architecture: **command sequence templates**, not fixed TypeScript adapters.

Split templates into:

1. **mux template** — how to create panes, run commands in panes, send input, attach, close.
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
- `on_error`

Avoid loops, conditionals, parallelism, retries, or rollback DSL in MVP. This is not a workflow engine.

`run` is shell-command based by default.

Template variables:

- provide raw values, e.g. `{{message}}`, `{{cwd}}`;
- provide shell-escaped variants, e.g. `{{message_shell}}`, `{{cwd_shell}}`;
- command strings should use `_shell` variants.

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

Prompt storage vs delivery:

- Always write prompt to `prompt.md` in the Session dir for audit/debug.
- The agent template decides how the prompt is actually delivered.

Prompt delivery modes:

- `arg` — pass prompt as CLI argument.
- `stdin` — pipe prompt to process.
- `file` — pass prompt file path to CLI if supported.
- `paste` — start agent, then use mux `send` sequence to paste prompt.

Initial builtin agent templates:

- `claude`
- `codex`
- `pi`
- `gemini` / `agy`
- `opencode`

Exact commands should be verified during implementation; do not assume all CLIs accept prompt files.

### Launch script standard

Use a session-specific launch script as the standard mechanism to inject env and start the agent.

Reasons:

- Some muxes may not support env-aware pane spawning.
- Avoid leaking tokens in command-line args, labels, or history.
- Centralize shell escaping.

Session env variables to inject:

```sh
AS_SESSION_ID=...
AS_PARENT_SESSION_ID=...
AS_WORKSPACE_ID=...
AS_WORKTREE_ROOT=...
AS_PROJECT_ROOT=... # optional alias for cwd/worktree root if useful
AS_SESSION_TOKEN=...
```

DB stores only `token_hash`, not the raw token.

## Operation design

Use shared operation handlers and schema in core. CLI and MCP are thin projections.

### CLI

Resource-style CLI:

```sh
asem init
asem init-session
asem session create
asem session list
asem session get
asem session attach
asem session close
asem session delete
asem message send
asem message list
asem report parent
asem mcp
asem tui
```

Notes:

- `asem init` creates `.asem.yaml` if missing and adds `.asem/sessions/` to `.gitignore`.
- `asem init-session` registers the already-running current agent/session.
- `asem session create --as-parent` launches a root Session with no parent.
- Normal `asem session create` defaults parent to the current Session if env/current file provides one.
- `asem session attach` actually attaches to the external mux.
- `asem message list --inbox` filters to current Session as target.
- `asem message list --undelivered` filters delivery failures.

### MCP

Initial MCP server is stdio:

```sh
asem mcp
```

Initial MCP tools:

- `init_session`
- `create_session`
- `list_sessions`
- `get_session`
- `close_session`
- `delete_session`
- `send_message`
- `report_parent`
- `list_messages`

MCP intentionally does **not** implement `attach_session`.

`get_session` may return `attach_hint` for human/operator use.

### Current Session registration

Need both:

1. `init-session` — register the currently running parent agent/session.
2. `session create --as-parent` — launch a new root/parent Session if no parent exists.

`init-session` requires explicit mux reference to be a deliverable Session. Do not rely only on auto-detection.

After `init-session`, print shell exports:

```sh
export AS_SESSION_ID=...
export AS_SESSION_TOKEN=...
export AS_WORKSPACE_ID=...
export AS_WORKTREE_ROOT=...
```

Also write a project-local current-session file so CLI can infer current Session where appropriate.

### Auth / local trust model

Agent-originated operations require Session token verification.

- `from_session_id` must match token.
- Token hash is stored in DB.
- Raw token is injected via env / 0600 files.

Human/operator CLI and TUI operations may operate without Session token under local trust. TUI is considered an operator surface.

### Message formatting

When injecting into the target agent pane, wrap raw message body in a short header so the receiving agent knows where it came from.

Example:

```text
[asem message from parent]
<message body>
```

For reports:

```text
[asem report from reviewer-1]
<report body>
```

Store both:

- `body` — user-provided body;
- `formatted_body` — exact text sent to mux.

### Create Session flow

Final flow:

1. Resolve config `.asem.yaml`.
2. Resolve `workspace_id` and `worktree_root`.
3. Resolve current Session parent unless `--as-parent` or `--no-parent`.
4. Create Session dir under `.asem/sessions/<id>/`.
5. Write prompt file.
6. Execute mux `create` sequence and capture mux refs.
7. Generate launch script with env and agent command.
8. Execute mux `run_in_pane` sequence to start launch script.
9. Register Session in SQLite only after successful start.
10. If any step fails before DB registration, return error and attempt mux cleanup; do not leave failed Session rows.

Run logs go to Session dir. On create failure, return the temp/session log path in the error.

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

TUI is a human **Session cockpit**. It is not a Session launcher in MVP.

Initial TUI supports:

- inspect Sessions;
- inspect detail/messages/context;
- send message to selected Session;
- attach to selected Session;
- close Session;
- delete Session;
- refresh/filter.

Initial TUI does **not** support:

- creating Sessions;
- `report_parent`;
- live transcript embedding;
- durable unread state.

### TUI scope

Default:

```sh
asem tui --scope worktree
```

Supported scope options:

```sh
asem tui --scope worktree
asem tui --scope workspace
```

No `--scope all` in MVP.

- `worktree` scope shows only current `workspace_id + worktree_root`.
- `workspace` scope shows all Sessions with same `workspace_id`, grouped by `worktree_root`.
- In `workspace` scope, operations on other worktrees are allowed because the human explicitly chose workspace-wide view.

### TUI visual layout

Chosen via design-deck:

- layout: **2-pane + tabbed detail**;
- send interaction: **centered textarea modal**.

Final wire direction:

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

Left pane:

- Session tree, parent-child hierarchy by default.
- In workspace scope, group first by `worktree_root`, then show tree.
- Compact row format: status symbol + name + agent + ephemeral badge.

Status symbols:

```text
… starting
● running
○ exited
! missing
× closed
```

Right pane tabs:

1. **Messages** — default tab.
2. **Detail** — Session metadata.
3. **Context** — scope/config/mux/template context.

Messages tab row format:

```text
10:05 parent → reviewer-1 [message] body...
10:09 helper-1 → reviewer-1 [message] body... ! undelivered
```

Messages are shown chronological ascending for selected Session-related messages.

Detail tab fields:

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

Context tab fields:

- `workspace_id`
- `worktree_root`
- `cwd`
- config path
- default mux
- default agent
- selected Session mux ref summary

Bottom keybar:

```text
↑/↓ select
Tab switch tab
a attach
s send
c close
D delete
r refresh
f filter
? help
q quit
```

Send modal:

- centered modal;
- multi-line textarea;
- Enter inserts newline;
- Ctrl+Enter sends;
- Esc cancels.

Attach behavior:

- same as cuekit-style external mux switch;
- `a` runs the attach command and leaves TUI temporarily;
- when mux exits/returns, TUI refreshes automatically.

Refresh behavior:

- auto refresh every ~3–5 seconds;
- manual `r` refresh;
- get/list refresh should lightly check mux liveness and update status to exited/missing if needed.

New message UI:

- no persistent read/unread DB state;
- ephemeral badge/highlight for messages that arrived since TUI start / last observed baseline.

Close/delete:

- both require confirmation dialogs;
- delete is destructive and also removes related messages.

TUI operator auth:

- TUI is a local operator surface;
- allow send/close/delete without Session token;
- still use confirmations for destructive actions.

TUI implementation order:

- after DB+CLI, mux templates, and MCP handlers are stable.

## MVP implementation order

Preferred order:

1. **Monorepo scaffold**
   - Bun + TypeScript.
   - Packages: `core`, `store`, `cli`, `mcp`, `tui`.

2. **Core schemas and domain helpers**
   - Session schema.
   - Message schema.
   - Config schema.
   - Scope resolution (`workspace_id + worktree_root`).
   - Token hashing/verification.
   - Template variable interpolation and shell escaping.

3. **Store**
   - SQLite init/migrations.
   - sessions/messages CRUD.
   - explicit delete_session message cleanup.
   - indexes and constraints.

4. **CLI baseline**
   - `asem init`.
   - `asem init-session`.
   - `asem session list/get`.
   - `asem message list`.

5. **Template engine + fake runner**
   - sequence execution.
   - capture JSONPath/regex.
   - timeouts.
   - logs to Session dir.

6. **Mux templates**
   - herdr, tmux, zellij builtin templates.
   - Use fake runner tests first.
   - Real integration tests optional/skipped if tools unavailable.

7. **Agent templates**
   - claude, codex, pi, gemini/agy, opencode.
   - Verify actual CLI prompt behavior before locking commands.

8. **Create/send/close/delete operations**
   - launch script standard.
   - env injection.
   - DB registration only after successful start.
   - best-effort message delivery.

9. **MCP stdio**
   - expose agreed tools using shared handlers.
   - no MCP attach.

10. **TUI**
    - OpenTUI in `@asem/tui`.
    - 2-pane + right tabs + bottom keybar.
    - no creation UI in MVP.

## Testing strategy

Use fake command runner as the primary test harness.

Test categories:

- config parsing;
- scope resolution;
- token hash/verification;
- interpolation and shell escaping;
- sequence execution order;
- JSONPath/regex capture;
- timeout behavior;
- launch script generation;
- store constraints/index behavior;
- CLI handler behavior;
- MCP handler behavior;
- TUI view-model behavior.

Real mux tests:

- herdr/tmux/zellij integration tests should be optional.
- Skip if binary unavailable.
- Do not require real mux in default CI.

## Open questions / intentionally deferred

- Exact builtin command templates for each agent CLI must be verified in the new repo.
- No config validation CLI in MVP, but likely useful after first templates exist.
- No worktree creation support; external tools/scripts create worktrees, then call `asem` inside them.
- No broadcast/role-targeted messages in MVP.
- No all-workspace/global TUI view in MVP.
- No live transcript embedding in TUI MVP.
- No durable unread/read receipts.
- No template marketplace or DB-managed templates.

## Files created from this handoff session

- `HANDOFF.md` — this document.
- `CONTEXT.md` — domain glossary for asem.
- `/tmp/asem-tui-mock.html` — earlier standalone HTML mockup.
- A design-deck session was shown with selections:
  - `layout`: **2-pane + tabbed detail**
  - `send-modal`: **Centered textarea modal**
