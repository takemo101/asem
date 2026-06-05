# asem 設計原則

> Related architecture: [`overview.md`](./overview.md)

## 1. Session First

asem の中心 resource は Session です。

- Session は agent CLI process + multiplexer pane + durable registration を表す。
- Session は task、job、workflow step ではない。
- Session status は process/connection state のみを表す。

`completed` / `failed` / `blocked` のような work outcome は Session status に入れません。

## 2. Message, Not Event

asem は Message history を持つが、event stream を持たない。

- Message は Session 間 communication の durable record。
- Report は parent Session 宛ての Message。
- Message delivery は best-effort。
- ack、read receipt、durable unread state は MVP に入れない。

「何が起きたか」をすべて event 化しない。asem が扱うのは communication record です。

## 3. Effective Scope is Workspace plus Worktree

Normal visibility and messaging are bounded by:

```text
workspace_id + worktree_root
```

`workspace_id` だけでは不十分です。複数 worktree は同じ logical workspace を共有していても、通常は別の作業境界です。

TUI の `--scope workspace` は human operator が明示的に選ぶ例外です。

## 4. Local First

asem はまず local development environment で強いことを優先する。

- global SQLite state
- worktree-local Session files
- local multiplexer control
- stdio MCP
- human CLI / TUI

Remote orchestration、distributed tenancy、server-hosted coordination は MVP の中心ではない。

## 5. Minimal Persistent Model

v0 の durable model は最小にする。

- `sessions`
- `messages`

以下は concrete need が出るまで追加しない。

- roles
- tasks
- artifacts
- claims
- read/unread table
- event table
- template registry table

将来に備えた余白は残すが、未使用 table で future を先取りしない。

## 6. Templates over Adapters

Runtime integration は TypeScript adapter class ではなく command sequence template で表す。

- mux template: pane/session control
- agent template: command and prompt delivery
- sequence engine: run/write/wait/capture/timeouts/logging

この設計により、実 CLI の flag や prompt delivery 差分を template と tests で扱える。

ただし command sequence は workflow DSL ではありません。loops、conditionals、parallelism、retry DSL、rollback DSL は入れません。

## 7. Modularity by Clear Boundaries

asem のモジュール性は「小さい package を増やすこと」ではなく、**責務・依存方向・差し替え点が明確であること**で担保する。

- `core` は domain / schema / pure helpers に集中する。
- `store` は SQLite persistence と row mapping に集中する。
- `cli` / `mcp` / `tui` は surface projection に集中する。
- runtime 差分は mux / agent template と sequence runner に閉じ込める。
- operation handler は surface と storage/runtime の間の semantic boundary になる。

Module boundary を越えて便利関数を直接呼び合うより、typed input/output と injected ports を通す。これにより、store、runner、template、surface を個別にテスト・交換できる。

Bad signs:

- `cli` と `mcp` が同じ Session 作成 logic を別々に持つ。
- `core` が SQLite や real shell execution を直接知る。
- template 実行が TUI や CLI rendering に依存する。
- package を分けているのに domain decision が複数箇所に散らばる。

## 8. Shared Semantics, Different Surfaces

CLI と MCP は command shape が違ってよいが、semantic operation は共有する。

- CLI は human rendering を担当する。
- MCP は tool request/response を担当する。
- operation handler と schema が behavior の source of truth。

Surface ごとの convenience 実装で semantic drift を起こさない。

## 9. Human Operator Surface is Explicit

Human/operator operations は local trust model に従う。

- CLI は human surface。
- TUI は human Session cockpit。
- TUI は MCP operation ではない。
- attach は MCP に出さない。

Destructive operations は local trust でも confirmation / force gate を置く。

## 10. Explicit over Implicit

asem は推測で重要な境界を埋めない。

- current Session は env / current-session file / explicit flag から解決する。
- deliverable Session には explicit mux ref が必要。
- parent Session は `--parent <session-id>` / `--root` (`--no-parent`) / current Session で明示的に決まる。
- template command は raw value ではなく shell-escaped variable を使う。

Auto-detection は便利機能に留め、security や delivery semantics の前提にしない。

## 11. Secret Safety by Default

Session token は raw value として DB に保存しない。

- DB stores token hash only.
- token-bearing files use mode `0600`.
- launch script centralizes env injection.
- tokens are not placed in pane labels, command-line args, or history when avoidable.

Secret handling は template convenience より優先する。

## 12. Error Semantics over Exceptions

Recoverable operational failure は structured error として返す。

Examples:

- `config_not_found`
- `scope_mismatch`
- `invalid_session_token`
- `sequence_step_failed`
- `message_delivery_failed`

Throw は defect、corruption、programmer error など異常停止が妥当な場合に限る。

## 13. Future-Compatible, Not Future-Bloated

拡張しやすい seam は作るが、将来機能を先に実装しない。

Good:

- mux refs as JSON for runtime-specific coordinates
- template variables with raw and shell-escaped variants
- explicit operation handlers shared by CLI/MCP
- optional TUI workspace scope

Bad:

- workflow engine 前提の state machine
- role / team / strategy concepts
- event bus before concrete need
- remote auth / tenancy model before local MVP

## 14. Domain Language is a Guardrail

`CONTEXT.md` の語彙を設計の guardrail にする。

- Use: Session, Message, Report, Workspace, Worktree Root, Effective Scope, Multiplexer, Agent, Template, Command Sequence, Cockpit
- Avoid: Task, Job, Workflow, Role, Coordinator, Result, Completion, Durable Inbox

名前がズレると責務もズレる。実装前に用語を確認する。
