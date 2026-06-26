# ADR 0003: TUI sends are operator-originated, not current-Session-attributed

## Status

Accepted for MVP design. Updated by
[ADR 0008](./0008-workspace-scoped-session-tree.md), which changes the normal
communication boundary to Workspace while preserving TUI operator-originated
sends.

## Context

`send_message` decides a Message's source by resolving the current Session when
appropriate: when one resolves and its token is verified, the call is
agent-originated and the Message is attributed to that verified Session;
operator-originated sends are recorded with no source attribution.

The TUI cockpit is the human operator surface. It may act on Sessions across
Worktree Roots in one Workspace. That raised an attribution risk: if a TUI send
reused current-Session resolution, the human operator's Message could be
recorded as if it came from an agent Session — silently impersonating a Session
the human is not.

## Decision

A human operator Message is never attributed to a current-Session pointer.

`OpContext` carries an `origin` marker. The TUI sets `origin: "operator"` on its
`send_message` call, which forces the human local-trust path: the operation does
not resolve or authenticate any current Session and records the Message with
`from_session_id = null` and the unattributed `[asem message]` header.

- The marker lives in the surface-built `OpContext`, never in the
  `send_message` input schema, so MCP/CLI input cannot set it; an agent cannot
  use it to send anonymously.
- When `origin` is unset, messaging keeps auto-detecting origin from the
  current-Session pointer: agent-originated (verified token) when one resolves,
  human when none does. MCP and CLI behavior is unchanged.
- `report_parent` is unaffected: it always acts as the verified current Session
  and never carries an operator origin.

This introduces no read/unread, ack, or task semantics. It only fixes who a
recorded Message is from.

## Consequences

- A workspace-scope TUI send into a sibling worktree is recorded as
  operator-originated, even when that worktree has its own current Session.
- The cockpit's long-standing "operator local trust, no source attribution"
  contract is now enforced by the operation rather than relying on the operator
  worktree happening to lack a current-Session pointer.
- Agent-originated `send_message` (MCP) and `report_parent` semantics are
  unchanged.
- Tests must cover a TUI send to a sibling worktree that has its own
  current-Session pointer and assert the Message is unattributed.

## Rejected alternatives

### Add an `operator`/`external` flag to the `send_message` input schema

Rejected. The input schema is parsed from MCP and CLI arguments, so an
agent-originated call could set the flag and send a Message with no attribution,
defeating token-based source attribution. Origin belongs to the surface-built
context, not to external input.

### Attribute the send to the target worktree's current Session

Rejected. This is the bug. The human operator is not the agent registered in the
target worktree; recording the Message as if they were is a silent
impersonation and misleads the recipient about who sent it.

### Give the TUI a null `CurrentSessionResolver`

Rejected. Swapping a port per surface to change one operation's semantics hides
the decision in composition wiring and would also alter close/delete auth
resolution. Making the origin explicit in `OpContext` keeps the rule visible at
the callsite and scoped to messaging.
