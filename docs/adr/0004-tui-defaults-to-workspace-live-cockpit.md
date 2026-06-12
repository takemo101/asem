# ADR 0004: TUI defaults to a workspace-wide live cockpit

## Status

Accepted for implementation planning.

## Context

The original MVP design made `asem tui` default to `worktree` scope, with
`--scope workspace` as an explicit broader view. That was conservative and
aligned with the normal operation boundary: `workspace_id + worktree_root`.

Operator feedback showed that this default makes the TUI feel stale. Sessions
are often created dynamically from other Sessions or sibling worktrees, while the
human operator expects the cockpit to show the whole local workspace. A
worktree-only cockpit can be correct by scope rules but still fail the operator's
main job: noticing which Sessions now exist and whether they are running,
missing, closed, or receiving Messages.

cuekit's TUI works better as a cockpit because it gives a live, themed overview
with auto-refresh, status rows, and compact recent context. asem should borrow
that presentation model without borrowing cuekit's Task/Team/workflow domain.

## Decision

`asem tui` should open a workspace-wide live cockpit by default.

```sh
asem tui                  # workspace scope
asem tui --scope worktree # current worktree only
asem tui --scope workspace
```

The workspace-wide TUI remains a human operator surface. Non-TUI CLI and MCP
operations remain normally scoped by `workspace_id + worktree_root`.

The cockpit will move toward an OpenTUI/React renderer, following cuekit's visual
structure: themed header, panels, selected rows, compact footer, modal overlays,
auto-refresh, and recent context. The implementation should preserve asem's
semantic boundary by keeping operation logic in `@asem/ops` and view-model logic
in pure TUI modules.

Live changes are displayed as in-memory TUI activity derived by diffing snapshots
while the cockpit is open. These activity rows are not durable Messages, not an
event stream, and not unread/read receipt state.

Cross-worktree mutations from the TUI continue to run with `cwd` set to the
selected Session's `worktree_root`, so shared ops re-resolve the target Effective
Scope. TUI sends continue to set `origin: "operator"` as required by
[ADR 0003](./0003-tui-operator-message-attribution.md), preventing accidental
impersonation of a sibling worktree's current Session.

## Consequences

- The default TUI is more useful for supervising dynamic local Session creation.
- Worktree-only focus remains available through `--scope worktree`.
- The TUI remains the single sanctioned workspace-wide human view; this does not
  broaden normal CLI/MCP behavior.
- Documentation and CLI usage must change from "default worktree" to "default
  workspace" when implemented.
- Tests must cover workspace grouping, cross-worktree operation safety, and
  operator-originated sends.
- The OpenTUI renderer adds a UI dependency to `@asem/tui`, but it should not be
  imported by MCP server paths except when launching the human TUI.

## Rejected alternatives

### Keep `worktree` as the default and ask users to pass `--scope workspace`

Rejected. It preserves the conservative default, but it leaves the primary
operator cockpit path looking stale whenever Sessions are launched outside the
current worktree.

### Add durable activity/events to support the cockpit

Rejected. The cockpit only needs recent visual feedback while it is open. Durable
Events would blur asem's Message-not-Event boundary and invite workflow semantics
that belong outside the MVP.

### Replace the existing TUI core with React-only state

Rejected. It would make visual iteration easier, but it risks duplicating
operation semantics and discarding the current testable reducer/projection
boundary. OpenTUI should be a renderer/host over the cockpit model, not the new
source of behavior.
