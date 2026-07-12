# TUI right-pane redesign

**Status:** Approved visual direction; implementation plan pending.

## Goal

Make the TUI cockpit's right pane easier to scan and more coherent without changing asem's Session, Message, delivery, or operation semantics.

The approved direction is **Session dossier + calm terminal**:

- low-noise dark terminal palette;
- green for running/incoming/selected, amber for outgoing/starting, red only for notification failure;
- structured headings and spacing rather than one undifferentiated key-value list.

## Scope

Redesign the presentation of the existing `Messages`, `Detail`, and `Context` tabs. Keep the existing snapshot, operation, and action model.

### Shared Session dossier header

The right pane has a persistent header for the selected Session:

- status;
- Session name;
- agent, mux, optional profile;
- relative update time.

Tabs remain Messages, Detail, and Context. The header does not infer work outcome or add persistent state.

### Messages

Use a chronological **timeline ledger**:

- each entry begins with time, direction (`IN` / `OUT`), Message kind, and counterpart;
- report bodies are expanded by default;
- ordinary Messages are initially compact previews and can be expanded through local UI state;
- entries are separated with restrained rules;
- a failed notification renders a durable notice: `Notification failed · Message is stored · no auto-resend`.

The notice must not imply Agent acceptance, Message loss, an acknowledgement, or a resend action.

### Detail

Use an **operational summary** ordered for ordinary operator decisions:

1. status, name, agent, mux, optional profile, parent;
2. cwd and Worktree Root;
3. lifecycle timestamps;
4. a collapsed Technical section containing Session id, runtime session directory, mux coordinates, and attach hint.

Technical data remains available but does not dominate the default view.

### Context

Use a **relationship card** with no inline quick actions:

- parent Session;
- selected Session;
- child Sessions;
- Workspace and location metadata in a separate section.

Context is read-first. Attach, send, close, and delete remain the global cockpit actions; Context must not become a workflow or orchestration surface.

## Interaction and responsive behavior

- The existing global keybar remains the source for actions.
- Existing Session selection and tab switching remain unchanged.
- At narrow widths, Detail and Context stack their sections vertically; no information is removed.
- Message expansion state is ephemeral local UI state only. It is never persisted and never becomes a read/unread receipt.

## Architecture boundaries

- `@asem/ops` remains the semantic source for operations and snapshots.
- `@asem/tui` owns presentation-only grouping, formatting, ephemeral expansion state, and rendering.
- No new Store columns, Message fields, MCP tools, CLI commands, or delivery states are introduced.
- The TUI continues using its explicitly internal workspace snapshot for full history; public cursor pagination semantics are unchanged.

## Testing

Add or update deterministic TUI view-model/component tests for:

- dossier header fields and status presentation;
- timeline direction/kind/durable-failure notice;
- report-expanded vs ordinary-message preview presentation;
- collapsed/expanded Technical details;
- relationship card parent/selected/children and separated location metadata;
- narrow-width stacking where represented by the view layer;
- no change to shared operation inputs/outputs or durable state.

## Non-goals

- task/workflow status, roles, orchestration controls, automatic resend, read receipts, or auto-wake;
- changing Message persistence/delivery behavior;
- redesigning the left Session tree, modals, or global action semantics in this slice.
