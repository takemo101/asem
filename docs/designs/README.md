# asem Design Notes

This directory contains feature and subsystem design notes that are stable enough to guide implementation.

Use these notes for current product shape and implementation reference. Use `docs/architecture/` for cross-cutting boundaries and principles. Use `docs/adr/` for decisions that are hard to reverse and need explicit trade-off records.

## Designs

- [`asem-session-manager-design.md`](./asem-session-manager-design.md) — MVP Session manager design covering Session / Message, scope, storage, command sequence templates, CLI/MCP/TUI, testing, and implementation order.

## When to add here

Add a document here when a feature or subsystem design becomes stable enough to guide implementation.

Do not add:

- temporary handoffs;
- one-off bug reports;
- step-by-step task checklists;
- ADR-level decisions without a design body.
