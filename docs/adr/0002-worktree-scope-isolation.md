# ADR 0002: Worktree scope isolation

## Status

Accepted for MVP design. TUI default-scope behavior is refined by
[ADR 0004](./0004-tui-defaults-to-workspace-live-cockpit.md); normal CLI/MCP
operations remain worktree-isolated by default.

## Context

asem needs a boundary for normal Session visibility, Message sending, and parent-child relationships.

A workspace id alone is not enough. Multiple Git worktrees can represent separate isolated working copies while sharing the same logical project identity. If asem allowed normal messaging across all worktrees with the same workspace id, agents could accidentally send instructions or reports to Sessions working in a different checkout.

## Decision

Normal effective scope is:

```text
workspace_id + worktree_root
```

Resolution:

1. `workspace_id` comes from `.asem.yaml` `workspace.id`.
2. `worktree_root` is `git rev-parse --show-toplevel`, realpathed, when available.
3. Outside Git, `worktree_root` is cwd realpath.

Normal operations must require both fields to match:

- Session list/get;
- Message send/list;
- parent-child relation;
- close/delete by scoped lookup.

TUI has one explicit exception:

```sh
asem tui --scope workspace
```

In workspace scope, the TUI may display and operate on Sessions across worktrees with the same `workspace_id`, grouped by `worktree_root`, because the human explicitly chose the broader view.

There is no `--scope all` in MVP.

## Consequences

- Separate worktrees are safe by default.
- Agents cannot normally message Sessions in sibling worktrees just because they share `.asem.yaml` `workspace.id`.
- The TUI can still provide a workspace-wide cockpit for humans.
- Store queries must include scope filters by default.
- Tests must cover same workspace / different worktree isolation.
- Config naming remains logical; filesystem isolation remains real.

## Rejected alternatives

### Scope by workspace id only

Rejected. This would make same-project worktrees visible to one another by default and risks cross-worktree message accidents.

### Scope by worktree root only

Rejected. This loses the logical grouping and makes workspace-wide TUI mode less meaningful.

### Global scope for all local Sessions

Rejected for MVP. It is too easy to leak messages across unrelated projects and contradicts local worktree isolation.
