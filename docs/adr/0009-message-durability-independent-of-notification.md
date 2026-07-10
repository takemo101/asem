# ADR 0009: Message durability is independent of notification transport

## Status

Accepted (2026-07-10). Detailed protocol:
[Message Protocol Design](../designs/asem-message-protocol-design.md).

## Context

Operators saw flaky inter-agent communication: reports that "never came back"
and sends that "failed". The earlier behavior mixed two different concerns:

- whether a Message exists (durable record);
- whether a notification reached the target Session's multiplexer pane.

Under the superseded behavior, a malformed or missing target mux Template could
block a send before any Message row was written, and a `mux: none` target was
treated as a non-deliverable failure that recorded an actionable
`delivery_error` telling the operator to re-register with a deliverable mux.
That conflated notification-transport problems with Message existence and made
pane injection look like the source of truth.

asem intentionally does not own an Agent turn loop (it is not an
Omnigent/Direct-style harness), so it can never prove that a model read,
understood, or acted on a Message. What it can guarantee is durable history
and retrievability.

## Decision

For a valid, authorized Message, asem guarantees exactly two things:

1. it persists a durable Message record **before** notification or mux
   template resolution; and
2. the target Session can retrieve that record by pulling through the CLI or
   MCP query protocol.

The Multiplexer is a best-effort notification/input transport, never the
Message source of truth. The public delivery states are:

- `delivered` — the target mux `send` Command Sequence completed successfully;
  this does not prove Agent/model acceptance;
- `undelivered` — the Message was persisted but no successful notification
  outcome is recorded; this is the normal state for a `mux: none` target,
  which makes no notification attempt and needs no remediation hint;
- `failed` — a notification attempt failed, including a malformed or missing
  target mux Template required for that attempt.

A Message operation succeeds once persistence succeeds; notification failure
is represented on the returned envelope and the durable record, not as an
operation-level failure, and never means the Message should be resent.
Invalid input, authorization failure, a missing target Session, and failure to
write the durable record still fail the operation.

asem does not add acknowledgement state, read receipts, auto-wake, server
push, or an SDK requirement. Agents retrieve Messages with cursor-paginated
`list_messages` and a bounded Inbox `wait`; when an Agent checks its Inbox
remains a human prompt / Agent Profile decision.

## Consequences

- A transport/template failure can no longer erase or block a valid Message.
- `mux: none` becomes a normal pull-only fallback for externally started
  Agents rather than an error state; new Messages to such Sessions are
  `undelivered`, not `failed`. Historical rows keep any old `delivery_error`
  recorded under the previous behavior; past outcomes are not rewritten.
- Parents that need reliability poll or wait on the durable store instead of
  trusting pane text.
- CLI/MCP surfaces project one public Message envelope with a structured
  `delivery` object; `formatted_body` and internal ordering stay internal.
- The Session Manager Design's earlier wording (invalid template blocks a
  send before any Message row; `mux: none` records an actionable
  `delivery_error`) is superseded by this ADR.

## Rejected alternatives

### Acknowledgement / read-receipt state

Rejected. asem cannot observe model acceptance without owning the Agent loop,
so any ack state would be fabricated. Durable retrievability plus best-effort
notification is honest.

### Auto-wake, push, or a polling daemon

Rejected. Coordination cadence is a human prompt / Profile decision; a bounded
long-poll (`wait`) is enough without background infrastructure.

### Failing the send operation on notification failure

Rejected. It made durable history look unreliable and pushed callers to
resend, creating duplicate durable Inbox Messages.

### Requiring an SDK/Direct delivery adapter

Rejected as a requirement. Any Agent that can run the asem CLI or MCP can
participate; SDK adapters may only ever be optional per-Agent transports.
