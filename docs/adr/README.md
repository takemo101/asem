# asem ADRs

Architecture Decision Records capture decisions that are hard to reverse, surprising without context, or trade-off driven.

Use ADRs for durable decisions. Use `docs/designs/` for feature/subsystem design and `docs/architecture/` for cross-cutting principles.

## Records

- [`0001-sqlite-and-session-files-are-source-of-truth.md`](./0001-sqlite-and-session-files-are-source-of-truth.md) — Session / Message state lives in global SQLite; sensitive runtime files live under worktree-local Session directories.
- [`0002-worktree-scope-isolation.md`](./0002-worktree-scope-isolation.md) — normal visibility and messaging are scoped by `workspace_id + worktree_root`.
- [`0003-tui-operator-message-attribution.md`](./0003-tui-operator-message-attribution.md) — TUI sends are operator-originated and never attributed to the target worktree's current Session.
- [`0004-tui-defaults-to-workspace-live-cockpit.md`](./0004-tui-defaults-to-workspace-live-cockpit.md) — `asem tui` defaults to a workspace-wide live cockpit while normal CLI/MCP scope remains worktree-isolated.
- [`0005-agent-prompt-delivery-uses-command-templates.md`](./0005-agent-prompt-delivery-uses-command-templates.md) — Agent prompt delivery is expressed with command templates, replacing `prompt_delivery`.
- [`0006-surface-specific-logger-composition.md`](./0006-surface-specific-logger-composition.md) — Logger implementations are selected by CLI/MCP/TUI surface so protocol and terminal output stay safe.
- [`0007-agent-profiles-are-explicit-prompt-shaping.md`](./0007-agent-profiles-are-explicit-prompt-shaping.md) — Agent Profiles are explicit prompt-shaping bundles, not workflow roles or automatic selectors.

## ADR rules

- Keep each ADR focused on one decision.
- Include context, decision, consequences, and rejected alternatives.
- Do not use ADRs for implementation checklists.
- If an ADR changes, add a superseding ADR rather than silently rewriting history.
