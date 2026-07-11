# Concepts

asem uses a small vocabulary. These words describe local runtime state, not project-management workflow.

## Session

A Session is a registered agent process or launched child process. It has local metadata, a Multiplexer reference, and Message history.

Session status is process or connection state only. It is not work outcome. A closed Session is not a failed task; it is just no longer live.

## Message

A Message is durable local communication addressed to a Session. The local store row is the source of truth. Multiplexer pane delivery is best-effort notification/input, reported as public `delivery` state: `delivered`, `undelivered`, or `failed`. A `failed` delivery is a notification failure only; the Message is stored and is never automatically resent.

Reading is pull-based. Surfaces return one page at a time as `{ messages, nextCursor, hasMore }`, ordered oldest to newest, and expose only the public envelope fields: `id`, `fromSessionId`, `toSessionId`, `kind`, `body`, `createdAt`, and `delivery`. Bodies are capped at 65,536 UTF-8 bytes; pages default to 20 and cap at 50 Messages.

## Message Cursor

A Message Cursor is an opaque position in one paged Message query. Every page carries a `nextCursor`; passing it back with the same filter continues without duplicates or skips. `latest` starts at the tail (an empty page) for an explicit fresh start. A bounded Inbox wait requires a concrete cursor and treats timeout as a successful empty page (`timedOut: true`). Cursors are bound to one query and never grant access.

## Report

A Report is a child Session's summary sent to its parent Session. Reports are Messages with parent-oriented semantics.

## Workspace

A Workspace is a logical project id and the normal boundary for Session visibility, parent-child relationships, Messages, and Reports. It lets related Worktree Roots share a project identity without requiring remote tenancy.

## Worktree Root

The Worktree Root is the filesystem root for a checkout or Session `cwd`. asem stores it as location metadata for launch files, cleanup, grouping, and explicit filters; it is not the normal parent/message/report boundary.

## Effective Scope

The Effective Scope is the resolved Workspace plus any explicit location filter, such as worktree or repo. Normal Session visibility and messaging use the Workspace; Worktree Root narrows views only when requested.

## Repo Alias

A Repo Alias is a named `cwd` shortcut configured under a Workspace root. `asem session create --repo <alias>` launches the child Session from that directory while preserving same-Workspace parent and Report behavior.

## Multiplexer

A Multiplexer hosts Session panes or processes. Builtin Templates can target tools such as tmux, zellij, herdr, and rmux.

## Agent Template

An Agent Template defines the command sequence for launching an AI client. It may support a model shell fragment through `{{model_shell}}`.

## Agent Profile

An Agent Profile is explicit prompt shaping plus optional launch defaults. Profiles are not roles, teams, workflow states, or result evaluators.

## Integration Target

An Integration Target is an external AI client or tool whose local config can be updated by `asem mcp add --for` or `asem skills add --for`.

Integration Targets are not Session Agents. Setup commands are CLI-only and are not exposed through the asem MCP server.

## What asem is not

asem is not a task board, scheduler, swarm runtime, hosted service, branch manager, or success/failure interpreter. Use it to manage local agent Sessions and communication, not to model project workflow.
