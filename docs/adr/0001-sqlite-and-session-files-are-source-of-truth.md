# ADR 0001: SQLite and Session files are the source of truth

## Status

Accepted for MVP design.

## Context

asem manages live local agent Sessions and communication between them.

It needs two kinds of state:

1. durable structured records for Sessions and Messages;
2. runtime files such as prompts, launch scripts, logs, and token-bearing files.

mikan uses Markdown files as the source of truth because its core resource is a human/agent-editable Issue. asem has a different core resource: live Session registration and Message delivery attempts. Those records need scoped lookup, uniqueness constraints, indexes, token verification, and delivery metadata.

## Decision

Use:

```text
~/.asem/state.db
```

as the durable source of truth for:

- Sessions;
- Messages.

Use:

```text
<worktree_root>/.asem/sessions/<session_id>/
```

as the source of truth for Session-local runtime files:

- `prompt.md`;
- launch script;
- run logs;
- raw token files or other token-bearing files.

The database stores token hashes only. Raw token material lives only in env or mode-`0600` files.

`asem init` adds ignore rules for runtime-generated token/log state:

```gitignore
.asem/sessions/
.asem/current-session*.json
.asem/tokens/
```

## Consequences

- SQLite can enforce Session name uniqueness per Workspace.
- Message history can be queried by Workspace, location metadata, target Session, delivery error, and creation time.
- Session files remain local to the worktree that owns the run.
- Sensitive runtime files do not enter Git history by default.
- Humans can still inspect prompts and logs with ordinary tools.
- asem must implement careful file mode handling for token-bearing files.
- asem must avoid treating `.asem/sessions/` as portable project data.

## Rejected alternatives

### Markdown files as the only source of truth

Rejected for MVP. Markdown works well for mikan Issues, but asem needs indexed lookup, scoped uniqueness, token hash verification, and delivery metadata. Encoding all of that in Markdown would create weak query and consistency semantics.

### Project-local SQLite only

Rejected for MVP. A global DB makes cross-shell and cross-agent discovery easier while operation-level scope still prevents accidental cross-worktree access.

### Store raw tokens in SQLite

Rejected. Token hashes are enough for verification. Raw token storage increases the blast radius of DB exposure.
