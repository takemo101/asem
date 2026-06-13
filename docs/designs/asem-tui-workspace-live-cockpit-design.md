# asem TUI Workspace Live Cockpit Design

## Status

Draft, 2026-06-12. This refines the MVP TUI design in
[`asem-session-manager-design.md`](./asem-session-manager-design.md) after
operator feedback that dynamically created Sessions are not visible enough and
that the current terminal UI should move closer to cuekit's cockpit UI.

## Context

The MVP TUI already has the right semantic boundary: it is a human Session
cockpit over shared `@asem/ops` handlers, not a workflow engine. Its current
implementation is intentionally conservative: a pure view-model, a render
projection, and a minimal ANSI host.

That shape is testable, but it leaves two product problems:

1. `asem tui` does not make newly created Sessions obvious while the cockpit is
   open.
2. The ANSI rendering lacks cuekit's visual hierarchy: header, themed panels,
   selected rows, compact footer, and clear live status.

This design borrows cuekit's OpenTUI cockpit presentation and refresh model while
keeping asem's smaller domain. It must not introduce cuekit concepts such as
Tasks, Teams, Roles, workflow status, event streams, result interpretation, or
scheduler behavior.

## Goals

- Make `asem tui` useful as a workspace-wide cockpit by default.
- Reflect dynamically created, closed, missing, and messaged Sessions without
  requiring manual refresh.
- Use OpenTUI/React for the human cockpit presentation, following cuekit's
  component structure and theme discipline.
- Preserve the existing pure TUI core where practical: view-model, selectors,
  action reducer, key mapping, and `@asem/ops` effects remain the semantic
  source.
- Surface recent changes as in-memory TUI activity, not durable Message/Event
  semantics.
- Keep cross-worktree operations safe: target the selected Session's
  `worktree_root`, and keep sends operator-originated.

## Non-goals

- Creating Sessions from the TUI in this slice.
- Live transcript embedding.
- Durable unread/read receipt state.
- Persistent event table or task event stream.
- Task, role, team, strategy, worker-pool, or workflow outcome UI.
- Remote, multi-user, or server-hosted dashboard semantics.
- Replacing CLI/MCP operation semantics inside React components.

## Decisions

### Default scope

`asem tui` should open the workspace cockpit by default:

```sh
asem tui                  # workspace scope
asem tui --scope worktree # current worktree only
asem tui --scope workspace
```

Rationale: the TUI is a human operator cockpit. Operators primarily use it to see
what is happening across dynamically created local Sessions, including sibling
worktrees that share the same `workspace_id`. Keeping the default worktree-only
makes the cockpit look stale when helpers are launched elsewhere.

This does not change normal CLI/MCP visibility. Normal non-TUI operations remain
scoped by `workspace_id + worktree_root`. The TUI remains the single human
operator surface with workspace-wide visibility.

### Renderer

Add an OpenTUI/React host for the cockpit and make it the normal `asem tui`
renderer. The current ANSI host may remain as a fallback or test/simple host, but
new UI polish should target OpenTUI.

The OpenTUI layer should adapt the existing `CockpitView` projection first rather
than moving operation semantics into React state. If a component needs new data,
add it to the pure state/projection layer and test it there.

### Refresh model

Use cuekit's simple auto-refresh model:

- refresh every 3 seconds while the cockpit is idle;
- manual refresh remains on `r`;
- pause auto-refresh while send/confirm/help/error modals are open;
- refresh immediately after send/close/delete/attach returns;
- do not add a background daemon or scheduler.

A refresh reads the active cockpit scope:

- `workspace` scope uses `load_workspace_snapshot`;
- `worktree` scope uses scoped `list_sessions` and `list_messages`.

Liveness checks remain lightweight and process/connection-only. A Session moving
from `running` to `missing` or `exited` is not a work outcome.

### In-memory activity strip

The cockpit should compute a short in-memory activity list by diffing the
previous and next snapshots during refresh. Activity items are view state only;
they are never stored in SQLite and are not Messages.

Initial activity kinds:

- `session_added` — new Session id appeared;
- `session_removed` — Session id disappeared after delete;
- `status_changed` — process/connection status changed;
- `message_added` — new Message id appeared;
- `delivery_changed` — delivery result changed from pending/error/success.

The right pane keeps the current Session tabs, with an activity strip below the
active tab content or in a compact right-pane sub-section:

```text
[Messages] Detail Context

12:05 external → reviewer [message] ping
12:07 reviewer → parent [report] found issue

Activity
+ /repo/b new Session helper-2
! /repo/a reviewer running → missing
+ parent received 2 Messages
```

Activity should be capped, for example at the latest 8-12 rows. Selecting a
Session on the Messages tab still observes its incoming Messages and clears its
ephemeral badge. Activity rows do not create durable unread state.

### Visual structure

Follow cuekit's cockpit conventions, adapted to asem vocabulary:

- one-line header with product, scope, workspace id, refresh state, and version;
- left panel titled `Sessions` with worktree groups in workspace mode;
- themed rows with status glyph/color, selected marker, new-Session marker, and
  ephemeral incoming-message badge;
- right panel with `Messages`, `Detail`, and `Context` tabs;
- activity strip as a compact sub-section in the right panel;
- bottom footer with available keys and `auto 3s` state;
- renderer-neutral `CockpitNotice` feedback for transient status/error
  messages;
- OpenTUI toast notifications for `CockpitNotice` feedback, positioned above
  the footer;
- centered modal components for send/confirm/help/error.

Use a small theme module like cuekit's `theme.ts`:

```ts
bg, headerBg, headerFg, panel, panelAlt, row, rowAlt,
rowSelected, border, muted, text, strong, cyan, green, yellow, red, purple
```

Status color/glyphs stay process-state oriented:

```text
… starting
● running
○ exited
! missing
× closed
```

### Selection and workspace grouping

In workspace mode, Sessions are grouped by `worktree_root`, then organized as a
parent-child tree within each group. Parent-child links never cross worktree
groups. New Session markers and badges are shown on the Session rows, not as
persistent state.

If a refresh removes the selected Session, selection falls back to the nearest
visible row. If the selected Session remains, preserve selection even when new
Sessions appear above it.

### Operation safety

Cross-worktree operations use the selected Session's `worktree_root` as the
operation `cwd`, as already designed. This lets `@asem/ops` resolve the target
Effective Scope normally instead of bypassing scope checks.

TUI sends continue to pass `origin: "operator"`, so a human send in workspace
scope cannot impersonate a sibling worktree's current Session. This remains the
rule from [ADR 0003](../adr/0003-tui-operator-message-attribution.md).

Operator-initiated mutation failures (`send`, `close`, `delete`) should open a
dismissible error modal. These are direct responses to a human action and should
not be hidden in transient notice feedback. Refresh and auto-refresh failures
remain non-modal `CockpitNotice` errors because they may repeat on every interval
and should not trap the operator in a reopening modal. While the renderer owns
the terminal, operation logs should not write JSON/prose lines directly to
stdout/stderr; the cockpit should surface human-relevant status and errors
in-band.

### Transient cockpit notices

`CockpitNotice` is renderer-neutral, transient cockpit feedback. It is not a
Message, Report, Activity item, durable event, or unread/read state. It replaces
the old string-only `statusLine` projection with a typed view value:

```ts
type CockpitNotice =
  | { level: "success"; message: string }
  | { level: "info"; message: string }
  | { level: "error"; message: string; code: string };
```

`CockpitApp` owns the current notice as effect-level transient state and projects
it through `CockpitView.notice`. Pure reducer state remains focused on Session
selection, filters, tabs, modals, drafts, and in-memory Activity.

OpenTUI renders notices as toasts through `@opentui-ui/toast`:

- use the package only inside the OpenTUI renderer path;
- position the toaster at `top-right` with a small top/right offset so it avoids
  the footer keybar and keeps the operator controls unobscured;
- use `stackingMode: "single"` so a new notice replaces the previous one;
- suppress a new toast when it has the same `level`, `message`, and `code` as
  the immediately previous notice;
- show `success` and `info` notices for about four seconds;
- show `error` notices for eight to ten seconds;
- render error toast title as the human message and description as
  `code: <code>`;
- style the toaster with existing OpenTUI theme tokens rather than a distinct
  external look.

The OpenTUI footer becomes a compact keybar/auto-state footer with no status
row. The ANSI/string renderer remains a fallback and should render
`CockpitView.notice` as a footer line, preserving textual feedback without
pulling in OpenTUI or the toast dependency.

Auto-refresh errors set an error notice. A later successful auto-refresh clears
that notice rather than leaving stale fallback text or emitting a recovery toast.

## Suggested package shape

Keep `@asem/tui` as the package. Add OpenTUI/React dependencies there only:

```text
packages/tui/src/
  app.ts                  # pure app/effect orchestration and auto-refresh loop
  view-model.ts           # reducer/selectors and modal state
  view.ts                 # renderer-agnostic CockpitView projection
  activity.ts             # snapshot diff → in-memory ActivityItem[]
  opentui/
    host.tsx              # OpenTUI entrypoint / adapter
    app.tsx               # OpenTUI component tree
    keys.ts               # OpenTUI key translation
    theme.ts              # OpenTUI theme tokens
    components/
      header.tsx
      session-list.tsx
      detail-pane.tsx
      activity-strip.tsx
      footer.tsx
      modal.tsx           # send/confirm/help/error modal frame/content
```

If implementation reveals that `CockpitApp.run()` needs a timer-capable host,
extend the host seam deliberately rather than letting React components call ops
directly.

## Implementation slices

1. **Activity projection**
   - Add `ActivityItem` and snapshot diff tests.
   - Add activity storage to `CockpitState` as ephemeral state.
   - Update `applySnapshot` to produce/cap activity rows.

2. **Auto refresh**
   - Add a timer path in the cockpit app/host seam.
   - Pause while modals are open.
   - Preserve manual `r` refresh and effect-after-mutation refresh.

3. **Workspace default**
   - Change CLI `asem tui` default to `workspace`.
   - Keep `--scope worktree` for local-only focus.
   - Update usage and tests.

4. **OpenTUI host**
   - Add OpenTUI/React components that render the existing projection plus
     activity strip.
   - Use reactive terminal dimensions, fixed header/footer, `minHeight: 0` for
     scrollable panes, and clipped detail body to avoid resize overlap.
   - Keep ANSI host tests or fallback until OpenTUI smoke tests exist.

5. **Polish and QA**
   - Header/footer copy.
   - Status/error display.
   - Empty states.
   - Responsive narrow-terminal behavior.
   - Dogfood with multiple Sessions across at least two worktrees.

## Testing strategy

Default tests still use fakes and should not require a real terminal,
OpenTUI-rendered snapshots, or real multiplexers.

Required tests:

- workspace default flag parsing and usage output;
- `--scope worktree` still shows only the current worktree;
- workspace scope groups Sessions by `worktree_root`;
- refresh preserves selection when possible;
- refresh falls back when the selected Session disappears;
- added Session produces an activity row and a row marker;
- status change produces an activity row;
- new Message produces activity and an ephemeral badge;
- opening a send/confirm/help/error modal pauses auto-refresh;
- operator send/close/delete failures open an error modal;
- refresh and auto-refresh failures stay as non-modal `CockpitNotice` feedback;
- TUI cross-worktree send remains `from_session_id = null`;
- OpenTUI components import without pulling into MCP paths;
- resize/layout smoke: header/footer fixed, main panes do not overlap footer.

## Documentation updates required with implementation

- Update `docs/designs/asem-session-manager-design.md` TUI section when the
  implementation lands.
- Update CLI usage docs from default `worktree` to default `workspace`.
- Keep `CONTEXT.md` vocabulary unchanged; no new domain term is required.
- Do not introduce durable Activity/Event terminology outside this TUI design.
