# asem アーキテクチャ概要

> Related design: [`../designs/asem-session-manager-design.md`](../designs/asem-session-manager-design.md)

## 採用: Local Session Substrate + Template Runtime

asem は **local agent session manager** です。中心は task orchestration ではなく、以下の安定した境界です。

- Session / Message domain model
- effective scope (`workspace_id + worktree_root`)
- persistent state model
- command sequence template runtime
- CLI / MCP / TUI control surfaces

mikan と同じく local-first な設計を採用します。ただし source of truth は Markdown issue files ではなく、Session / Message の durable state と worktree-local Session files です。

```text
~/.asem/state.db                  # Session / Message の durable state
<worktree_root>/.asem/sessions/   # prompt, launch script, token-bearing files, logs
<worktree_root>/.asem/agents/     # project-local Agent Profile files
.asem.yaml                        # project-local config and templates
external AI client config files    # Integration Target MCP/Skill setup, when explicitly installed
```

## パッケージ構成

| Package | 役割 | 外部 I/O | 主責務 |
|---|---|---|---|
| `@asem/core` | pure domain / schema / port contracts | なし | Session / Message / Config schema、scope types、operation input/output、port interfaces、token hash、pure shell escaping helper |
| `@asem/runtime` | template runtime | injected command/file/clock/logger ports | template registry、template interpolation、sequence execution、capture、fake runner contract、core shell escaping helper の利用 |
| `@asem/profiles` | Agent Profile resolution | filesystem through injected/rooted inputs | builtin profiles、user/project profile discovery、Markdown/frontmatter parsing、source precedence、effective prompt rendering |
| `@asem/integrations` | Integration Target setup | filesystem through explicit config/Skill paths | supported external AI client registry、MCP config installers、Skill installers、atomic config writes |
| `@asem/store` | persistence adapter | SQLite | migrations、row mapping、Session / Message CRUD、scoped transaction primitives、workspace-wide read primitives (`*ByWorkspace`) for the TUI `--scope workspace` view |
| `@asem/ops` | shared operation handlers | injected ports only | auth/scope checks、create/send/close/delete/list use-cases、operation-level cleanup semantics |
| `@asem/cli` | installed human CLI | stdin/stdout/stderr、shell | command parsing、human rendering、`asem mcp` / `asem tui` 起動 |
| `@asem/mcp` | AI-facing control surface | MCP stdio | MCP tool projection、shared operation handlers への委譲 |
| `@asem/tui` | human Session cockpit | terminal UI、attach command | Session list、detail/messages/context tabs、send/attach/close/delete |

MVP では `@asem/ops` と `@asem/runtime` を明示的な package/module として扱います。これにより CLI/MCP/TUI に use-case logic が散らばることと、template execution が core や surface に混ざることを防ぎます。

## モジュール境界

asem の module は、package 境界と runtime component 境界の両方で考える。

| Module boundary | Owns | Must not own |
|---|---|---|
| Domain | Session / Message / Scope の意味、schema、pure state rules | SQLite connection、shell execution、UI rendering |
| Store | migrations、query、row mapping、transaction primitives | command sequence execution、MCP/CLI rendering、delete use-case semantics |
| Operations | use-case orchestration、auth/scope checks、shared semantics、operation-level cleanup | surface-specific formatting、runtime-specific command strings、SQLite connection details |
| Template Runtime | template registry、template interpolation、sequence execution、capture、fake runner contract、core shell escaping helper の利用 | Session outcome interpretation、workflow branching、surface rendering、独自 shell escaping 実装 |
| Mux Templates | herdr/tmux/rmux/zellij pane control steps | agent prompt semantics |
| Agent Templates | agent command (prompt placeholders / paste_prompt) and launch hooks | multiplexer pane lifecycle |
| Agent Profiles | behavior instructions, profile source precedence, effective prompt rendering | workflow roles、task outcomes、multiplexer lifecycle、agent process invocation |
| Integration Targets | external AI client setup for asem MCP registration and Skills | Session launch semantics、Agent Template behavior、workflow roles、AI-facing config mutation tools |
| Surfaces | CLI/MCP/TUI input-output projection | duplicated domain decisions |

モジュール分割の目的は「後から差し替えられること」と「小さい範囲でテストできること」です。特に以下は replaceable seam として保つ。

- SQLite store implementation
- command runner / fake runner
- mux templates
- agent templates
- CLI / MCP / TUI projection

逆に、Session / Message / Effective Scope の意味は project-wide に一つだけです。ここを surface や template ごとに再定義しない。

## 依存方向

```text
@asem/cli ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           ├─> @asem/runtime
           ├─> @asem/mcp
           ├─> @asem/tui
           └─> @asem/integrations

@asem/mcp ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           └─> @asem/runtime

@asem/tui ─┬─> @asem/core
           ├─> @asem/ops
           ├─> @asem/store
           └─> @asem/runtime

@asem/ops ─┬─> @asem/core
           ├─> @asem/runtime
           └─> @asem/profiles

@asem/runtime       ─> @asem/core
@asem/profiles      ─> @asem/core
@asem/store         ─> @asem/core
@asem/integrations  ─> no required project package dependencies
@asem/core          ─> no project package dependencies
```

Rules:

- `core` は project package に依存しない。
- `store` / `runtime` / `profiles` / `ops` は `core` の schema / type / port contracts に依存してよい。
- `ops` は `runtime` の pure template/sequence ロジック（template schema、`SequenceEngine`、redactor）に依存してよい。`runtime` 自体が injected port (`TemplateRunner` など) 越しにしか I/O しないため、この依存は「concrete I/O を ops に持ち込まない」原則と矛盾しない。
- `ops` は `profiles` の profile resolution/rendering に依存してよいが、profile parsingやsource precedenceを重複実装しない。
- `ops` は concrete SQLite connection や real shell を import せず、injected ports だけを呼ぶ。
- `cli` / `mcp` / `tui` は semantic logic を重複実装しない。
- CLI と MCP は同じ operation handlers / schemas を呼ぶ。
- TUI は operator surface であり、MCP tool ではない。
- `integrations` は CLI-only Integration Target setup を持つ。外部AIクライアントの設定ファイルを書き換えるため、AI-facing MCP surface には公開しない。

## Runtime template の位置づけ

asem は cuekit のような TypeScript runtime adapter model ではなく、**command sequence templates** を中心にする。

```text
Mux Template
  create
  run_in_pane
  send
  attach
  close

Agent Template
  command            # may carry {{prompt_shell}} / {{prompt_path_shell}}
  paste_prompt       # optional; paste delivery instead of placeholders
  before_paste       # optional; only with paste_prompt
  before_agent       # optional launch.sh hook lines before the agent
  after_agent        # optional launch.sh hook lines after the agent

Agent Profile
  id                 # explicit profile selected by create_session
  instructions       # prompt-shaping text rendered before the user prompt
  agent/model        # optional launch defaults for user/project profiles
```

この選択の理由:

1. herdr / tmux / rmux / zellij のような multiplexer 差分を declarative command sequence に閉じ込める。
2. claude / codex / pi / agy / opencode の prompt delivery 差分（command placeholders か paste_prompt か）を agent template に閉じ込める。
3. TypeScript adapter 抽象を早期に固定せず、実コマンドの検証に合わせて template を調整できる。
4. fake command runner で sequence engine を先にテストできる。

Command sequence は startup/control procedure であり workflow ではありません。loops、conditionals、parallelism、retry DSL、rollback DSL は MVP に入れません。

## State model

### Durable state

`~/.asem/state.db` に以下を保存する。

- Sessions
- Messages

Session status は process/connection state のみです。

```ts
type SessionStatus = "starting" | "running" | "exited" | "missing" | "closed";
```

status は work outcome を表しません。

### Worktree-local files

`<worktree_root>/.asem/sessions/<session_id>/` に以下を保存する。

- `prompt.md`
- launch script
- run logs
- token-bearing files

Token-bearing files は mode `0600`。DB は token hash のみ保存します。

## Effective scope

Normal operations are scoped by both:

```text
workspace_id + worktree_root
```

This prevents accidental cross-worktree messaging when multiple worktrees share the same logical workspace id.

TUI only has an explicit escape hatch:

```sh
asem tui --scope workspace
```

The workspace-wide TUI may operate across worktrees because a human explicitly chose that view.

## Control surfaces

### CLI

Human/operator surface. Local trust model applies. Destructive operations still require explicit flags or confirmations where appropriate.

### MCP

Agent-facing stdio surface. Agent-originated operations require Session token verification. MCP does not expose attach.

### TUI

Human Session cockpit. It can inspect Sessions, send Messages, attach, close, and delete. It does not create Sessions in MVP and does not become a dashboard for tasks or workflow outcomes.

## Development order

```text
Core schemas/ports
  → Runtime fake runner + template engine
  → Store primitives
  → Ops handlers over injected ports
  → CLI baseline
  → Builtin mux/agent templates
  → create/send/close/delete operation coverage
  → MCP stdio projection
  → TUI view-model and UI
```

理由:

1. domain、scope、port contracts が先に固まらないと store/runtime/ops が安定しない。
2. template engine は fake runner で先に検証する。
3. store は scoped primitives と transaction を提供し、use-case semantics は ops に置く。
4. ops は injected store/runtime/filesystem/config/session deps で小さくテストする。
5. CLI / MCP は shared operation の projection として実装する。
6. TUI は stable store + operations の上に載せる。
