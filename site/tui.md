# TUI Cockpit

Open the Cockpit:

```sh
asem tui
```

The Cockpit is the human terminal surface for local Sessions in the Workspace. It projects shared operation semantics; it does not duplicate Session lifecycle logic.

## What it shows

- Workspace Session tree and selected Session details.
- Message and Report activity.
- Attach, close, delete, and refresh actions where available.
- Toast-style notices for operation results.

## Scope

The TUI defaults to workspace-live inspection. The Session list shows parent-child relationships across Worktree Roots and keeps each Session's location visible. Explicit worktree/repo views are filters over the Workspace, not separate communication semantics.

It does not infer task outcome from Session status. Closed means the process or pane is closed, not that the child succeeded or failed.

## Attach and close

Attaching is a human-only Multiplexer action. Closing uses the shared `close_session` operation and respects borrowed Multiplexer ownership.

## When to use the CLI instead

Use CLI commands when you need scriptable output, JSON output, MCP server startup, or Integration Target setup.
