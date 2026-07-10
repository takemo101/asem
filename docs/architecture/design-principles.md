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
- 有効で認可された Message は、notification や mux template 解決より前に必ず persist される。target Session は CLI/MCP の pull で Message を取得する。
- Multiplexer delivery は best-effort notification。public delivery state は `delivered` / `undelivered` / `failed` で、`delivered` は Agent/model の acceptance を意味しない。
- ack、read receipt、durable unread state、auto-wake は入れない。

「何が起きたか」をすべて event 化しない。asem が扱うのは communication record です。詳細な protocol は [`asem-message-protocol-design.md`](../designs/asem-message-protocol-design.md) と [ADR 0009](../adr/0009-message-durability-independent-of-notification.md) を参照。

## 3. Workspace is the Session Boundary

Normal visibility, parent-child relationships, Messages, and Reports are bounded by:

```text
workspace_id
```

`worktree_root` は Session の location metadata です。launch files、runtime cleanup、TUI grouping、CLI filters には使いますが、通常の親子関係や communication boundary には使いません。

同じ Workspace 内では、root Session が Workspace root cwd にいて、repo parent Sessions が別 cwd / Worktree Root にいても、同じ Session tree として扱います。

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

- current Session は env / Workspace current-session file / explicit flag から解決する。
- deliverable Session には stored `mux` + `mux_ref` が必要。`init-session` may safely derive those coordinates from the current process environment only when the Multiplexer already hosts that process (for example complete herdr pane env vars).
- 明示的な `mux: none` は pull-only Session として扱う。notification 試行は行わず、その Session 宛ての新しい Message は通常 `undelivered` になる。これは正常な fallback であり、public envelope に remediation hint は載せない。
- parent Session は `--parent <session-id>` / `--root` (`--no-parent`) / current Session で明示的に決まる。
- `--repo <alias>` のような Repo Alias は cwd を選ぶ convenience であり、親子関係や communication semantics を変えない。
- template command は raw value ではなく shell-escaped variable を使う。

Auto-detection は便利機能に留め、security や delivery semantics の前提にしない。Auto-detection が失敗した場合は、重要な境界を推測して `none` に落とさず、明示入力または actionable error に戻す。

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
- `workspace_mismatch`
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
- optional worktree/repo filters over the Workspace Session tree

Bad:

- workflow engine 前提の state machine
- role / team / strategy concepts
- event bus before concrete need
- remote auth / tenancy model before local MVP

## 14. Domain Language is a Guardrail

`CONTEXT.md` の語彙を設計の guardrail にする。

- Use: Session, Message, Report, Workspace, Worktree Root, Repo Alias, Multiplexer, Agent, Template, Command Sequence, Cockpit
- Avoid: Task, Job, Workflow, Role, Coordinator, Result, Completion, Durable Inbox

名前がズレると責務もズレる。実装前に用語を確認する。
