# TUI Cockpit

Open the Cockpit:

```sh
asem tui
```

The Cockpit is the human terminal surface for local Sessions in the Effective Scope. It projects shared operation semantics; it does not duplicate Session lifecycle logic.

## What it shows

- Session list and selected Session details.
- Message and Report activity.
- Attach, close, delete, and refresh actions where available.
- Toast-style notices for operation results.

## Scope

The TUI defaults to workspace-live inspection. It does not infer task outcome from Session status. Closed means the process or pane is closed, not that the child succeeded or failed.

## Attach and close

Attaching is a human-only Multiplexer action. Closing uses the shared `close_session` operation and respects borrowed Multiplexer ownership.

## When to use the CLI instead

Use CLI commands when you need scriptable output, JSON output, MCP server startup, or Integration Target setup.
