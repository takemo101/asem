# TUI Cockpit

Open the Cockpit:

```sh
asem tui
```

The Cockpit is the human terminal surface for local Sessions in the Workspace. It projects shared operation semantics; it does not duplicate Session lifecycle logic.

## What it shows

### Session tree

The left pane is the Workspace-scoped Session tree: it shows the selected Session and each Session's Worktree location context.

### Session dossier

The right pane is a persistent dossier for the selected Session: a fixed header plus **Messages, Detail, and Context** tabs.

### Messages

The Messages tab is a timeline of durable Messages and Reports. Reports always show their body; ordinary Message bodies and Detail Technical data are expanded only through local ephemeral UI state.

### Activity

Activity is a capped **in-memory** snapshot-delta strip. It begins after Cockpit start, is not durable history or unread state, and disappears when no activity exists.

### Scrolling

Messages, Detail, and Context use mouse wheel in-app scrolling for overflow; the dossier header, tabs, Activity, and global keybar remain fixed.

## Scope

The TUI defaults to workspace-live inspection. The Session list shows parent-child relationships across Worktree Roots and keeps each Session's location visible. Explicit worktree/repo views are filters over the Workspace, not separate communication semantics.

It does not infer task outcome from Session status. Closed means the process or pane is closed, not that the child succeeded or failed.

## Attach and close

Attaching is a human-only Multiplexer action. Closing uses the shared `close_session` operation and respects borrowed Multiplexer ownership.

## When to use the CLI instead

Use CLI commands when you need scriptable output, JSON output, MCP server startup, or Integration Target setup.
