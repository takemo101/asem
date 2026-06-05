# asem ADRs

Architecture Decision Records capture decisions that are hard to reverse, surprising without context, or trade-off driven.

Use ADRs for durable decisions. Use `docs/designs/` for feature/subsystem design and `docs/architecture/` for cross-cutting principles.

## Records

- [`0001-sqlite-and-session-files-are-source-of-truth.md`](./0001-sqlite-and-session-files-are-source-of-truth.md) — Session / Message state lives in global SQLite; sensitive runtime files live under worktree-local Session directories.
- [`0002-worktree-scope-isolation.md`](./0002-worktree-scope-isolation.md) — normal visibility and messaging are scoped by `workspace_id + worktree_root`.

## ADR rules

- Keep each ADR focused on one decision.
- Include context, decision, consequences, and rejected alternatives.
- Do not use ADRs for implementation checklists.
- If an ADR changes, add a superseding ADR rather than silently rewriting history.
