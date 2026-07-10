# asem Message Protocol Design

## Status

**Approved — 2026-07-10. This document is the detailed source of truth for the
final Message protocol.**

The decision record is [ADR 0009](../adr/0009-message-durability-independent-of-notification.md).
The durable documents (`CONTEXT.md`, `docs/architecture/`, the
[Session Manager Design](./asem-session-manager-design.md)) summarize the
protocol and link here. Behavior has not shipped yet; implementation follows
the slices below, and the CLI/MCP/README/site/Skill surface documentation is
updated as each slice lands.

## Context

asem should remain small and local-first, but its Message capability should be
a dependable interoperability layer between coding Agents.

asem is **not** an LLM runtime, SDK-first harness, scheduler, workflow engine,
or autonomous orchestrator. A human decides how Agents are coordinated through
prompts and optional Agent Profiles. asem supplies the communication substrate
that lets those instructions work across Claude, Pi, Codex, and future Agents.

This intentionally differs from Omnigent/Polly-style orchestration:

- asem does not own an Agent turn loop or prove that a model read, understood,
  or acted on a Message;
- asem does not own work items, worker pools, completion states, auto-wake,
  worktrees, branches, reviews, or merge decisions;
- direct SDK adapters may be optional future transports for individual Agents,
  but must never be required for Message interoperability.

## Goals

1. A valid Message is durable and can be retrieved later by the target Session.
2. Any Agent that can use the asem CLI or MCP can participate; a bespoke SDK is
   not required.
3. Agents can efficiently pull only new Messages without asem persisting a
   read/unread state.
4. Multiplexer delivery remains useful as a notification transport, but never
   defines whether the Message exists.
5. Human prompts and optional Profiles decide when an Agent checks its Inbox,
   replies, creates Sessions, or performs review.
6. The protocol remains bounded in storage and response size.

## Non-goals

This design does not add:

- Agent read receipts, acknowledgement state, or proof of model acceptance;
- auto-wake, server push, background scheduling, or a daemon that polls for
  Agents;
- task/workflow/role/result semantics;
- threads, reply IDs, attachments, arbitrary structured payloads, or automatic
  Message splitting;
- Session restart/resume or forwarding Messages to a replacement Session;
- an SDK requirement for any Agent;
- TOON output. JSON remains the current canonical surface format.

## Communication contract

### The portable guarantee

For a valid, authorized Message, asem guarantees:

1. it persists a durable Message record; and
2. the target Session can retrieve that record through the CLI or MCP query
   protocol.

asem does **not** guarantee that an Agent process, model loop, or human saw or
acted on that Message.

### Notification transport is separate

A Multiplexer is a best-effort notification/input transport, not the Message
source of truth.

| Public delivery state | Meaning |
| --- | --- |
| `delivered` | The target mux `send` Command Sequence completed successfully. This does **not** prove Agent/model acceptance. |
| `undelivered` | The Message was persisted, but no successful mux delivery outcome is recorded. This is normal for a Session registered with `mux: none`. |
| `failed` | The Message was persisted, but a mux notification attempt failed, including a missing or malformed target mux Template required for that attempt. A `mux: none` target makes no notification attempt and is `undelivered`. |

A Message operation succeeds once persistence succeeds, even when notification
fails. The failure is represented on the returned Message envelope and in the
durable record; it is not an operation-level failure. A `failed` delivery status
never means the Message should be resent: it describes notification transport
only, and a duplicate resend would create another durable Inbox Message.

A malformed/missing target mux Template must therefore no longer prevent a
valid Message from being recorded. Invalid Message input, authorization
failure, missing target Session, and failure to write the durable record still
fail the operation.

### `mux: none`

`mux: none` remains supported, but is not the normal way a parent creates a
child Session.

- `session create` creates a live Agent through a Multiplexer and therefore
  requires a usable mux Template.
- An externally started Agent that asem cannot launch may register itself with
  `init-session --mux none`.
- Such a Session has no notification channel. It receives Messages by pulling
  its Inbox through CLI/MCP, and new Messages to it are normally
  `undelivered`, not `failed`.

Existing historical rows retain any old `delivery_error` recorded under the
previous behavior; asem does not rewrite past delivery outcomes during this
migration.

This is a compatibility fallback for new or unusual Agents, not a new domain
entity or a formal `Pull-only Session` vocabulary term.

## Message payload and internal representation

### Payload limit

A Message is text-only. Its raw `body` must be at most **65,536 UTF-8 bytes**.
The generated mux header is not part of this input limit.

An oversized body returns `invalid_input` and no Message row is written. Large
content should be referenced by file path, commit, or another existing local
artifact instead of being embedded.

### Internal storage

The Store continues to retain the raw `body` and the exact mux-injected
`formatted_body` as an internal audit/transport value. `formatted_body` is not
part of the public communication protocol.

To make pagination cursors reliable, the `messages` table gains an internal,
monotonically increasing SQLite sequence:

```sql
sequence INTEGER PRIMARY KEY AUTOINCREMENT, -- internal ordering key
id       TEXT UNIQUE NOT NULL               -- existing UUID public identifier
```

The existing UUID remains the externally visible Message ID. The migration
rebuilds the SQLite `messages` table while preserving existing public IDs and
Message data; legacy rows receive deterministic sequence values ordered by
`created_at, id`. The sequence is never exposed as a CLI or MCP response
**field**; an opaque cursor may encode its position.

## Public Message envelope

Public CLI/MCP Message results project the internal row to this stable envelope:

```ts
type PublicMessage = {
  id: string;
  fromSessionId: string | null;
  toSessionId: string;
  kind: "message" | "report";
  body: string;
  createdAt: string;
  delivery:
    | { status: "delivered"; deliveredAt: string }
    | { status: "undelivered" }
    | { status: "failed"; error: string };
};
```

The public envelope intentionally excludes:

- `formattedBody`;
- `workspaceId` and `worktreeRoot` location metadata;
- the internal SQLite sequence;
- Session display-name snapshots.

Session names/location can be obtained with existing Session queries when
needed. Delivery errors remain redacted so Session tokens never reach output.

The projection applies consistently to `send_message`, `report_parent`,
`list_messages`, and the new wait operation. The Store/ops tests still verify
that the internal formatted mux text is exact.

## Cursor-based Message listing

`list_messages` is paginated for **all of its operation views**, not only Inbox
views. This does not change separate Store-internal snapshot reads. Normal
listing without a cursor reads history oldest-to-newest by internal sequence.

### API shape

MCP keeps view selection inside `filter`, while pagination fields are top-level:

```ts
list_messages({
  filter: { inbox: true },
  cursor?: string | "latest",
  limit?: number,
})

// response
{
  messages: PublicMessage[],
  nextCursor: string,
  hasMore: boolean,
}
```

- Default page size: **20** Messages.
- Maximum page size: **50** Messages.
- A page has a **256 KiB aggregate UTF-8 raw-body budget**. It may contain
  fewer than `limit` Messages when adding another body would exceed the budget.
  The first eligible Message is always returned even when a legacy body alone
  exceeds that budget, so a page is never empty while `hasMore` is true.
- `hasMore` is `true` when more matching Messages remain after the returned
  page, including when a page was cut by the body budget.
- `nextCursor` is always present, including for an empty page.

The cursor is an opaque caller-held value. It is bound to its Workspace and a
normalized query identity, including the resolved target `toSessionId` when the
view has one and every result-changing filter. Reusing it with a different
query or current Session Inbox is `invalid_input`; asem does not persist it as
read/unread state. Binding detects caller mistakes only: every list/wait call
independently resolves scope and authenticates the caller before comparing that
binding, and never trusts an ID encoded in a cursor for authorization.

The unfiltered Inbox list view (`filter: { inbox: true }`) and `wait_messages`
are the same query identity after current-Session resolution. An Inbox cursor
created with an extra filter such as `undelivered` or location metadata is not
valid for `wait_messages`.

`cursor: "latest"` is an explicit tail-start operation. It returns an empty
page with `hasMore: false` and a high-water `nextCursor`, intentionally
skipping historical Messages when a human explicitly decides they are not
needed. A caller that needs history omits the cursor and pages from the oldest
record.

`--undelivered` means every Message without a successful notification:
`delivery.status` is either `undelivered` or `failed`. An `undelivered` envelope
carries no remediation hint: `mux: none` is an intentional pull-only fallback,
and a human can inspect the target Session's mux configuration when needed.

### CLI surface

`asem message list` gains `--cursor <cursor|latest>` and `--limit <n>`.

- Text output renders the current Message rows and a footer with `has more` and
  the next cursor when another page is available.
- `asem message list --json` returns the same object shape as the
  operation/MCP response:

```json
{
  "messages": [],
  "nextCursor": "…",
  "hasMore": false
}
```

## Waiting for new Inbox Messages

### MCP `wait_messages`

A new agent-facing MCP tool provides one bounded long-poll. It is not push or
auto-wake.

```ts
wait_messages({
  cursor: string,             // required; never "latest"
  limit?: number,             // default 20, max 50
  timeoutMs?: number,         // default 30,000; max 60,000
})
```

Rules:

- It only waits for the verified current Session's unfiltered Inbox, the same
  query identity as `list_messages({ filter: { inbox: true } })`. It has no
  sender or kind filter, so every returned cursor advances through one
  unambiguous Inbox view and cannot silently skip a non-matching Message.
- It resolves and authenticates the current Session on every call; the cursor
  never grants access.
- Internally it polls the local Store once per second.
- It returns a normal page-shaped response as soon as one or more matching
  Messages arrive.
- A timeout is a successful empty result, not an operation error:

```json
{
  "messages": [],
  "nextCursor": "…",
  "hasMore": false,
  "timedOut": true
}
```

- On Message arrival it returns the same page result with `timedOut: false`.
  A burst returns a full bounded page, not only the first Message.

### Required Agent protocol

The shared asem Skill must state this protocol, without prescribing an
orchestration workflow:

1. At ordinary Session startup, call
   `list_messages({ filter: { inbox: true } })` without a cursor and consume
   oldest-to-newest pages until `hasMore` is false. Retain the final
   `nextCursor`. A new Session Inbox is normally empty or small, and this
   captures Messages sent while the Agent was launching.
2. When the human's prompt/Profile says waiting is appropriate, call
   `wait_messages` with that cursor.
3. After every list or wait response, retain its `nextCursor`; it is already a
   valid cursor for the next wait. Do not re-synchronize before every wait.
4. Use `list_messages({ filter: { inbox: true }, cursor: "latest" })` only
   when a human explicitly chooses to ignore earlier Inbox history and begin
   waiting from the current high-water mark.

How often an Agent waits, whether it delegates work, and how it responds remain
human prompt/Profile decisions.

### CLI surface

There is one CLI wait protocol, matching MCP exactly:

```sh
asem message wait --cursor <cursor> \
  [--limit <n>] [--timeout-ms <n>] [--json]
```

It always waits on the authenticated current Session's unfiltered Inbox. The
cursor is required; timeout is a successful empty page. Its text renderer
prints Message rows (or `no new Messages`) plus a status/cursor footer.

## Profiles, Skills, and new Agent compatibility

The shared asem Skill becomes a **protocol reference only**. It teaches:

- Session registration and identity;
- durable Message and delivery-state semantics;
- Inbox synchronization, cursors, and bounded wait;
- send/report operations and their boundaries.

It must not tell every Agent to create workers, create reviewers, fan out, or
follow a default orchestration loop. Those are decisions for a human prompt or
an optional project/user Agent Profile.

No new builtin Profile is introduced. Existing Profiles remain optional
prompt-shaping tools, not roles or orchestration policy.

New Agent adoption is progressive:

1. **Generic CLI protocol**: an externally started Agent registers with
   `init-session` and uses CLI Inbox/send commands.
2. **Template support**: add Agent/Mux Templates when asem should launch it or
   notify its pane.
3. **Integration Target support**: add MCP/Skill installation adapters when
   the Agent's configuration convention is known.

No step requires a model SDK.

## Implementation slices

Implement and review each slice separately.

1. **Durability independent of transport**
   - Persist valid Messages before mux/template resolution.
   - Treat malformed/missing mux templates as delivery failure, not Message
     creation failure.
   - Treat `mux: none` as normal `undelivered` notification state.
   - Add public Message envelope and delivery object projection.
   - Enforce 64 KiB UTF-8 body validation.

2. **Cursor pagination**
   - Migrate `messages` to internal SQLite sequence + UUID unique ID, recreate
     existing indexes, and add sequence seek indexes for Workspace and Inbox
     queries.
   - Keep sequence in a Store-internal row type; put the `PublicMessage`
     projection in ops so no CLI/MCP output can expose it or `formatted_body`.
   - Add oldest-to-newest cursor/`latest`/limit/hasMore/body-budget behavior to
     the shared list operation.
   - Guarantee at least one Message per non-empty page, including oversized
     legacy rows.
   - Update Store, ops, CLI, MCP, public JSON rendering, tests, and docs.

3. **Bounded Inbox wait and protocol documentation**
   - Add the shared unfiltered-current-Inbox wait operation and MCP tool.
   - Use an injected Clock/sleep dependency for fake-time long-poll tests;
     verify concurrent Store read/write behavior under the configured SQLite
     journal and timeout settings.
   - Replace the CLI wait surface with cursor-required current-Inbox semantics;
     do not retain `--to`, sender, or kind modes. A human without a registered
     current Session uses `message list` rather than `message wait`.
   - Update the shared Skill, README/site/CLI help, design docs, and tests.
   - Integration documentation must set a client tool deadline longer than the
     requested `timeoutMs`; the default is 30 seconds and timeout is success.

4. **Follow-on: `asem run` P0**
   - Implement only after the Message protocol is complete, so its bootstrap
     prompt can teach the final protocol once.
   - `asem run` is a human-facing root-Agent launcher only. It starts a root
     Session (`parent_session_id = null`); that root Session may later become
     a parent by creating child Sessions.
   - P0 adds no `asem run --parent`, no `--parent current`, no automatic
     parent detection, and no ambient-current fallback. Child Agent launch
     remains `asem session create`, called by a registered parent Agent. This
     keeps the command boundary clear and avoids duplicating the detached
     child launcher.
   - The planned TTY attach behavior does not change this boundary:
     `--no-attach` remains a root-launch escape hatch, not a child-launch
     mode.
   - Workspace / Worktree Root is location metadata, not a parent Session;
     launching from a Workspace root never implies a parent.

## Required durable documentation updates

Done on 2026-07-10 with this document's approval:

- `CONTEXT.md`, the Session Manager Design, and the architecture design and
  implementation principles now describe durable pull and best-effort
  notification transport, including the corrected malformed-template and
  `mux: none` wording;
- [ADR 0009](../adr/0009-message-durability-independent-of-notification.md)
  records that Message durability is independent from notification transport
  and why asem adds no acknowledgement state or auto-wake.

Remaining updates land with the implementation slices:

- CLI/MCP/manual/README/site documentation and the shared Skill, including the
  breaking `message list --json` page envelope and replacement of legacy
  `message wait --to` with current-Inbox cursor wait;
- the MIK-026 test rationale comments, which still describe the superseded
  invalid-template send behavior until slice 1 lands.

## Review focus

Reviewers should verify especially:

1. The design remains a Session/Message substrate and does not introduce hidden
   workflow/orchestration semantics.
2. The SQLite sequence migration preserves existing Message records and UUID
   API identities.
3. Cursor high-water/binding semantics cannot skip matching Messages, including
   messages sent while an Agent is launching, a current-Session switch, or an
   explicit `latest` tail-start.
4. Every non-empty Inbox can make progress: no empty page with `hasMore: true`.
5. The migration recreates existing indexes, adds sequence seek indexes, and
   preserves legacy IDs and deterministic `created_at, id` ordering.
6. The public Message projection does not leak token material or duplicate large
   bodies.
7. CLI and MCP delegate to one shared operation contract.
8. Transport/template failure cannot erase a valid Message.
