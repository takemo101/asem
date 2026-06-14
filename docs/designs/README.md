# asem Design Notes

This directory contains feature and subsystem design notes that are stable enough to guide implementation.

Use these notes for current product shape and implementation reference. Use `docs/architecture/` for cross-cutting boundaries and principles. Use `docs/adr/` for decisions that are hard to reverse and need explicit trade-off records.

## Designs

- [`asem-session-manager-design.md`](./asem-session-manager-design.md) — MVP Session manager design covering Session / Message, scope, storage, command sequence templates, CLI/MCP/TUI, testing, and implementation order.
- [`agent-profiles-design.md`](./agent-profiles-design.md) — explicit Agent Profile prompt-shaping design, source precedence, profile file format, Session metadata, and CLI/MCP discovery surfaces.
- [`asem-tui-workspace-live-cockpit-design.md`](./asem-tui-workspace-live-cockpit-design.md) — refined TUI design for a workspace-wide OpenTUI live cockpit with auto-refresh and in-memory activity.
- [`init-wizard-design.md`](./init-wizard-design.md) — opt-in interactive `asem init` setup flow for choosing default Agent/Multiplexer templates and materializing selected builtin Templates into `.asem.yaml`.
- [`integration-targets-design.md`](./integration-targets-design.md) — CLI-only Integration Target setup for installing asem MCP registration and Skills into supported external AI clients.

## When to add here

Add a document here when a feature or subsystem design becomes stable enough to guide implementation.

Do not add:

- temporary handoffs;
- one-off bug reports;
- step-by-step task checklists;
- ADR-level decisions without a design body.
