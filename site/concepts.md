# Concepts

asem uses a small vocabulary. These words describe local runtime state, not project-management workflow.

## Session

A Session is a registered agent process or launched child process. It has local metadata, a Multiplexer reference, and Message history.

Session status is process or connection state only. It is not work outcome. A closed Session is not a failed task; it is just no longer live.

## Message

A Message is durable local communication addressed to a Session. The local store row is the source of truth. Multiplexer pane delivery is best-effort notification/input.

## Report

A Report is a child Session's summary sent to its parent Session. Reports are Messages with parent-oriented semantics.

## Workspace

A Workspace is a logical project id. It lets related Worktree Roots share a project identity without requiring remote tenancy.

## Worktree Root

The Worktree Root is the filesystem root for the current checkout. asem uses it with Workspace to isolate normal visibility.

## Effective Scope

The Effective Scope is `workspace_id + worktree_root`. Normal Session visibility and messaging are scoped by this pair.

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
