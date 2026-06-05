# asem Architecture

このディレクトリは asem のアーキテクチャと設計・実装原則を管理します。

mikan の `docs/design.md` / ADR 運用を参考にしつつ、asem では詳細設計を `docs/designs/`、横断的な境界と原則を `docs/architecture/` に分けます。

## Documents

- [`overview.md`](./overview.md) — パッケージ構成、依存方向、runtime template、state の配置。
- [`design-principles.md`](./design-principles.md) — 設計時に守る原則。
- [`implementation-principles.md`](./implementation-principles.md) — 実装時に守る原則。

## Related documents

- [`../designs/asem-session-manager-design.md`](../designs/asem-session-manager-design.md) — MVP の中心設計。
- [`../adr/`](../adr/) — hard-to-reverse な判断。
- [`../../CONTEXT.md`](../../CONTEXT.md) — asem のドメイン語彙。
