# asem Docs

asem の現在の設計・アーキテクチャ・判断を読むための入口です。

mikan のドキュメント運用を参考に、以下を分けて管理します。

- 現在の設計: 実装の参照になる feature / subsystem design
- アーキテクチャ: パッケージ境界、依存方向、設計原則、実装原則
- ADR: 後から変えにくい設計判断とトレードオフ
- ドメイン語彙: `CONTEXT.md`

## Start here

1. [`../CONTEXT.md`](../CONTEXT.md)
   - asem の用語集。
   - `Task`, `Role`, `Workflow`, `Result`, `Inbox` などの誤用を避けるために最初に読む。

2. [`designs/asem-session-manager-design.md`](./designs/asem-session-manager-design.md)
   - MVP の中心設計。
   - Goals / Non-goals、Session / Message、Workspace boundary、storage、template runtime、CLI/MCP/TUI、実装順序を含む。
   - Message protocol の最終仕様(durable persist-before-notify、delivery states、cursor pagination、bounded Inbox wait)は [`designs/asem-message-protocol-design.md`](./designs/asem-message-protocol-design.md) を参照。
   - Agent Profile の詳細は [`designs/agent-profiles-design.md`](./designs/agent-profiles-design.md) を参照。
   - Integration Target setup の詳細は [`designs/integration-targets-design.md`](./designs/integration-targets-design.md) を参照。
   - TUI の最新改善方針は [`designs/asem-tui-workspace-live-cockpit-design.md`](./designs/asem-tui-workspace-live-cockpit-design.md) を参照。

3. [`architecture/overview.md`](./architecture/overview.md)
   - パッケージ構成、依存方向、runtime template の位置づけ。

4. [`architecture/design-principles.md`](./architecture/design-principles.md)
   - 設計時に守る原則。
   - asem が workflow engine に膨らまないための境界を定義する。

5. [`architecture/implementation-principles.md`](./architecture/implementation-principles.md)
   - 実装時の原則。
   - schema parsing、structured error、test-first fake runner、secret handling など。

6. [`adr/`](./adr/)
   - hard-to-reverse な判断とトレードオフ。

## Documentation rules

- 現在の feature / subsystem design は `docs/designs/` に置く。
- パッケージ境界・依存方向・原則は `docs/architecture/` に置く。
- 後から変えにくく、トレードオフを説明する必要がある判断は `docs/adr/` に置く。
- ドメイン語彙は `CONTEXT.md` を source of truth にする。
- `HANDOFF.md` は引き継ぎ資料であり、永続ドキュメントではない。設計が固まった内容は `docs/` と `CONTEXT.md` に移す。
