# ADR 0008: Workspace-scoped Session tree

## Status

Accepted. Supersedes [ADR 0002](./0002-worktree-scope-isolation.md) for normal
Session visibility, Message sending, Reports, and parent-child relationships.

## Context

The MVP scoped normal operations by `workspace_id + worktree_root`. That kept
separate worktrees isolated, but it made workspace-root supervision awkward in a
multi-repository workspace.

A common local workflow is:

```text
product workspace root
├── frontend repo
├── backend repo
└── docs repo
```

A human or root agent Session in the workspace root should be able to create and
supervise repo-specific parent Sessions while those Sessions run in their repo
cwd:

```text
root Session cwd=/work/product
├── frontend-parent cwd=/work/product/frontend
└── backend-parent cwd=/work/product/backend
```

Under the old scope rule, `asem session create --repo backend --parent <root>`
failed because the root Session and repo Session had different `worktree_root`
values. Treating `--repo` as anything more than a cwd shortcut also made the
mental model harder to explain.

## Decision

Normal Session relationships and communication are scoped by Workspace:

```text
workspace_id
```

Within one Workspace:

- Session names are unique.
- Parent-child relationships may cross cwd / Worktree Root boundaries.
- Messages may be sent by Session id across cwd / Worktree Root boundaries.
- `report parent` sends to the current Session's stored `parent_session_id`.

`worktree_root` remains on Session rows, but it is no longer the normal
relationship or communication boundary. It is location metadata used for:

- launch cwd and runtime file placement;
- TUI grouping and CLI filters;
- attach / close / delete execution context;
- repo/worktree-focused views.

`--repo <alias>` is a named cwd alias. It is equivalent to passing the alias's
resolved path as `--cwd`; it does not create a separate scope or special parent
semantics.

Repo Alias paths must resolve under the Workspace root that declares them. This
keeps config discovery, Workspace identity, Agent/Mux defaults, project-local
profiles/templates, and future child operations tied to one Workspace.

Current Session resolution is Workspace-oriented:

1. `AS_SESSION_ID` / `AS_SESSION_TOKEN` when present;
2. the Workspace current-session pointer when no env current is present.

`session create` does not update the Workspace current Session. Registering the
current terminal/pane with `init-session` may set the Workspace current Session;
an explicit current-session command may switch it later without changing parent
relationships.

## Consequences

- Workspace-root Sessions can supervise repo parent Sessions directly.
- `asem session create backend-parent --repo backend --parent <root-id>` is valid
  when both Sessions belong to the same Workspace.
- `asem session create backend-parent --repo backend` uses the Workspace current
  Session as parent when neither `--root` nor `--parent` is supplied.
- `report parent` is simple and cwd-independent: authenticate the current
  Session, read its `parent_session_id`, and persist a Report Message to that
  parent.
- CLI list/message views default to the Workspace and may offer worktree/repo/cwd
  filters. Existing `--scope worktree` wording may remain as compatibility UI,
  but the concept is a filter, not the relationship boundary.
- TUI remains a Workspace cockpit. Human-originated TUI sends stay
  operator-attributed rather than impersonating a current Session.
- Deleting a parent with children is protected: normal delete fails; `--force`
  may orphan children rather than cascade-delete them.
- Session runtime files remain under the Session's resolved `worktree_root`, for
  example `<worktree_root>/.asem/sessions/<session_id>/`.
- This is a breaking domain change. Existing state created under the old
  `workspace_id + worktree_root` normal scope may require a reset or explicit
  migration before the first release with this ADR.

## Rejected alternatives

### Keep worktree isolation and add workspace-level messaging

Rejected for this direction. It preserves old safety properties, but leaves two
communication models: parent/report inside a worktree and workspace message/report
across worktrees. The user-facing model remains harder to explain than a single
Workspace Session tree with cwd as Session metadata.

### Make all Session ids globally addressable

Rejected. Local unrelated projects still need a safety boundary. Workspace id is
the right boundary for cross-repo communication because it is explicit local
configuration.

### Remove Worktree Root entirely

Rejected. Worktree Root is still useful for runtime file placement, TUI grouping,
filters, and executing mux operations near the Session's working copy. The change
is to stop using it as the normal parent/message/report boundary.

### Let repo aliases point outside the Workspace root

Rejected for the initial design. External aliases require storing and reusing the
alias-declaring config path or Workspace root on each Session. Keeping aliases
inside the Workspace root preserves simple config discovery and avoids accidental
cross-project coupling.
