# TUI Right-pane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Session dossier + calm terminal redesign for the cockpit right pane.

**Architecture:** Keep `@asem/ops` and snapshot contracts unchanged. Add presentation-only typed right-pane projections in `@asem/tui`, rendered through the existing `CockpitView.right` line array. Any Message expansion state is ephemeral cockpit state only.

**Tech Stack:** TypeScript, Bun tests, existing pure TUI view-model/render projections.

## Global Constraints

- Do not change Message/Session persistence, delivery semantics, operation inputs, MCP, CLI, or global cockpit actions.
- `failed` means notification-only failure: show durable storage and no automatic resend.
- Context remains read-first; no inline attach/send/close shortcuts.
- Test production behavior first with pure view/view-model tests.

---

### Task 1: Structured right-pane presentation primitives

**Files:**

- Modify: `packages/tui/src/types.ts`
- Modify: `packages/tui/src/messages.ts`
- Modify: `packages/tui/src/view/right-pane.ts`
- Test: `packages/tui/test/messages.test.ts`
- Test: `packages/tui/test/view.test.ts`

**Interfaces:**

- Produce presentation-only Message timeline rows with direction, counterpart, kind, preview/body mode, and durable notice text.
- Preserve `MessageRow.message` as the source of all delivery facts.

- [ ] Write failing tests for inbound/outbound ledger headers, report expanded body, ordinary-message preview, and exact failed notice `Notification failed · Message is stored · no auto-resend`.
- [ ] Run `bun test packages/tui/test/messages.test.ts packages/tui/test/view.test.ts`; confirm the new assertions fail.
- [ ] Add pure row helpers/projections and render chronological timeline ledger lines with restrained separators.
- [ ] Run the same tests; confirm pass.

### Task 2: Detail and Context dossier layout

**Files:**

- Modify: `packages/tui/src/types.ts`
- Modify: `packages/tui/src/view/right-pane.ts`
- Test: `packages/tui/test/view.test.ts`

**Interfaces:**

- Detail renders Session summary, relation, location, lifecycle, then collapsed technical summary.
- Context renders relationship card ordered parent → selected → children and a separate Workspace/location section.

- [ ] Write failing right-pane assertions for operational summary order, collapsed Technical summary, relationship sections, and absence of inline action hints.
- [ ] Run `bun test packages/tui/test/view.test.ts`; confirm failure.
- [ ] Implement presentation-only line layouts using existing `DetailView` and `ContextView` data; do not add Store/ops fields.
- [ ] Run the focused test; confirm pass.

### Task 3: Persistent dossier header and renderer styling

**Files:**

- Modify: `packages/tui/src/view.ts`
- Modify: concrete terminal renderer files discovered from `CockpitView` consumers
- Test: corresponding TUI view/component tests

- [ ] Write failing tests that the right pane exposes a selected Session dossier header containing status, name, agent, mux, optional profile, and relative update label.
- [ ] Run targeted TUI tests; confirm failure.
- [ ] Add renderer-neutral header data and apply calm-terminal status/direction styling in the terminal renderer. At narrow widths stack Detail/Context sections without removing data.
- [ ] Run focused tests; confirm pass.

### Task 4: Documentation, review, and validation

**Files:**

- Modify: `docs/designs/asem-session-manager-design.md` only if its TUI description differs from the shipped result.
- Test: TUI test suite.

- [ ] Run `bun test packages/tui/test` and verify all tests pass.
- [ ] Run `bun run typecheck`, `bun run test`, and `bun run check`.
- [ ] Request an independent review focused on visual hierarchy, scope guards, delivery wording, and test coverage; repair blocking findings.
- [ ] Create a dedicated GitButler branch/commit, open a PR, merge after validation, and update MIK-068.
