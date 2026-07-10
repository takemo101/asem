# Durable Message Protocol and Root-only `asem run` P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan Issue-by-Issue. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved durable, pull-based Message protocol, then add `asem run` as a root-only human-facing Agent launcher.

**Architecture:** Keep internal `Message` storage separate from the public Message envelope. `@asem/store` owns a sequence-backed paged query; `@asem/ops` owns cursor binding, public projection, and bounded wait; CLI/MCP remain thin projections. `asem run` is a CLI composition over the existing root `createSession` use case, never a child launcher.

**Tech Stack:** Bun, TypeScript, Zod, `bun:sqlite`, existing fake Store/Clock/TemplateRunner, MCP stdio, CLI parser/renderers.

## Global Constraints

- Valid authorized Messages persist before mux/template resolution; notification failure never discards them.
- Public results contain only `id`, `fromSessionId`, `toSessionId`, `kind`, `body`, `createdAt`, and `delivery`.
- Raw Message body limit: 65,536 UTF-8 bytes. Page body budget: 256 KiB; default/max page size: 20/50.
- List order is internal sequence ascending. The first eligible legacy oversized Message must still be returned.
- Cursors are opaque, caller-held, scoped and query-bound; they are never authorization.
- Wait is verified-current-Session, unfiltered Inbox only; default/max timeout: 30/60 seconds; timeout is successful.
- Do not add acknowledgement/read state, auto-wake, server push, workflow/task semantics, SDK requirements, or a child mode to `asem run`.
- Use fake/injected Store, Clock, and runner dependencies in default tests. Run `bun run typecheck`, `bun run test`, and `bun run check` before every Issue PR.

---

### Issue 1: Durable Message creation and public delivery projection

**Files:**

- Modify: `packages/core/src/types/message.ts`, `packages/core/src/types/operations.ts`, `packages/core/src/index.ts`
- Create: `packages/ops/src/message-projection.ts`
- Modify: `packages/ops/src/operations/send-message.ts`, `packages/ops/src/index.ts`
- Test: `packages/core/test/schemas.test.ts`, `packages/ops/test/send-message.test.ts`

**Interfaces:**

- Produces `PublicMessage` and `projectPublicMessage(message: Message): PublicMessage`.
- Changes `SendMessageOutput.message` and `ReportParentOutput.message` to `PublicMessage`.
- Defines `MAX_MESSAGE_BODY_BYTES = 65_536` and validates byte length with `Buffer.byteLength(body, "utf8")`.

- [ ] Add the failing schema/operation tests: exactly 65,536 UTF-8 bytes succeeds; 65,537 bytes fails `invalid_input`; emoji boundaries count bytes; failed and undelivered public values omit `formattedBody`, location fields, and raw `deliveryError`.
- [ ] Run `bun test packages/core/test/schemas.test.ts packages/ops/test/send-message.test.ts` and confirm the new tests fail.
- [ ] Add the internal/public Message types and the sole projector. Keep `Message` and `formattedBody` internal; do not add sequence to `Message`.
- [ ] Change `deliver()` to build and insert the internal Message before resolving the mux Template. A malformed/missing target mux Template records a redacted notification failure on the persisted Message. `mux: none` makes no template lookup or send attempt and returns `undelivered`.
- [ ] Update `sendMessage` and `reportParent` to return the projector output. Preserve exact internal `formatted_body` storage and existing token redaction.
- [ ] Re-run the focused tests and `bun run typecheck`; commit this Issue alone.

### Issue 2: Sequence migration and paged Store primitive

**Files:**

- Modify: `packages/core/src/ports.ts`, `packages/core/src/types/operations.ts`
- Modify: `packages/store/src/migrations.ts`, `packages/store/src/rows.ts`, `packages/store/src/sqlite-store.ts`
- Modify: `packages/ops/src/testing/fakes.ts`
- Test: `packages/store/test/migrations.test.ts`, `packages/store/test/messages.test.ts`, `packages/store/test/row-parse.test.ts`

**Interfaces:**

- Add an internal Store page query/result with normalized filter, exclusive `afterSequence`, `limit`, and `bodyBudgetBytes`.
- Store row mapping carries `sequence` internally only.

- [ ] Add failing migration tests using a v4 fixture: UUID, all Message columns, and deterministic `created_at, id` order survive migration.
- [ ] Add failing page tests for ascending order, default/max limit, body-budget cut, one oversized legacy row, and `hasMore` progress.
- [ ] Add migration v5 that rebuilds `messages` with `sequence INTEGER PRIMARY KEY AUTOINCREMENT` and `id TEXT UNIQUE NOT NULL`; copy old rows ordered by `created_at, id`.
- [ ] Recreate `idx_messages_workspace_created`, `idx_messages_to_created`, and `idx_messages_delivery_error`; add `(workspace_id, sequence)` and `(to_session_id, sequence)` seek indexes.
- [ ] Implement the paged Store query and matching fake Store behavior. Preserve explicit internal workspace snapshot reads for the cockpit rather than exposing an unbounded public list.
- [ ] Run the focused store tests and `bun run typecheck`; commit this Issue alone.

### Issue 3: Opaque cursor and shared paginated `list_messages`

**Files:**

- Create: `packages/ops/src/message-cursor.ts`
- Modify: `packages/core/src/types/operations.ts`, `packages/ops/src/deps.ts`, `packages/ops/src/operations/list-messages.ts`
- Test: `packages/ops/test/message-cursor.test.ts`, `packages/ops/test/list-messages.test.ts`

**Interfaces:**

- `ListMessagesInput` gains top-level `cursor?: string | "latest"` and `limit?: number`.
- `ListMessagesOutput` becomes `{ messages: PublicMessage[]; nextCursor: string; hasMore: boolean }`.
- Cursor payload binds Workspace, normalized result-changing filter, resolved target Session ID when relevant, and exclusive sequence position.

- [ ] Write failing cursor tests for malformed/tampered cursor, Workspace mismatch, changed filter, switched current Inbox Session, multi-page no-duplicate/no-skip behavior, empty Inbox, and `latest`.
- [ ] Implement versioned base64url cursor encode/decode. It must reject mismatched query identity with `invalid_input`; it must not authorize a caller.
- [ ] Resolve scope and authenticate on every list call before comparing the cursor. Normalize `filter.inbox` to the verified current Session’s target ID.
- [ ] Implement `latest` as an explicit empty page with `hasMore: false` and a tail high-water cursor. A no-cursor request pages oldest-to-newest.
- [ ] Fetch Store pages, convert with the Issue 1 projector, and always return `nextCursor`.
- [ ] Run focused ops tests and `bun run typecheck`; commit this Issue alone.

### Issue 4: CLI, MCP, and cockpit pagination parity

**Files:**

- Modify: `packages/cli/src/parse.ts`, `packages/cli/src/run.ts`, `packages/cli/src/render.ts`, `packages/cli/src/usage.ts`
- Modify: `packages/mcp/src/tools.ts`, `packages/tui/src/cockpit.ts`
- Test: `packages/cli/test/parse.test.ts`, `packages/cli/test/run.test.ts`, `packages/mcp/test/tools.test.ts`, `packages/tui/test/messages.test.ts`

**Interfaces:**

- CLI: `asem message list [--cursor <cursor|latest>] [--limit <n>] [--json]`.
- MCP: `list_messages({ filter?, cursor?, limit? })`.
- Both return the shared page envelope; `--undelivered` means `delivery.status !== "delivered"`.

- [ ] Add failing CLI/MCP tests proving equivalent JSON pages and the absence of `formattedBody`, sequence, workspace/location metadata, and raw delivery errors.
- [ ] Parse/render cursor and limit in the CLI. Replace bare JSON arrays with the page envelope and add a human pagination footer.
- [ ] Update MCP input schema/tool handler to pass top-level cursor/limit into shared ops.
- [ ] Update cockpit callers to consume page results only where they use the operation; retain an explicitly internal snapshot path where a full cockpit history is required.
- [ ] Run focused surface tests and `bun run test`; commit this Issue alone.

### Issue 5: Bounded unfiltered Inbox wait

**Files:**

- Create: `packages/ops/src/operations/wait-messages.ts`
- Modify: `packages/core/src/types/operations.ts`, `packages/core/src/ports.ts`, `packages/ops/src/deps.ts`, `packages/ops/src/index.ts`, `packages/ops/src/testing/fakes.ts`
- Modify: `packages/mcp/src/tools.ts`, `packages/cli/src/parse.ts`, `packages/cli/src/run.ts`, `packages/cli/src/render.ts`, `packages/cli/src/usage.ts`
- Test: `packages/ops/test/wait-messages.test.ts`, `packages/mcp/test/tools.test.ts`, `packages/cli/test/parse.test.ts`, `packages/cli/test/run.test.ts`

**Interfaces:**

- `waitMessages(deps, { cursor, limit?, timeoutMs? }, ctx)` returns a list page plus `timedOut: boolean`.
- Add fakeable sleep/Clock dependency. Poll interval is 1,000 ms.
- MCP `wait_messages` and CLI `asem message wait --cursor <cursor>` have no `to`, `from`, `kind`, or `poll-ms` input.

- [ ] Write fake-time failing tests for timeout success, delayed arrival, burst page, max timeout rejection, wrong current Session, and non-Inbox cursor rejection.
- [ ] Reuse the Issue 3 unfiltered Inbox query identity and page fetch. Re-authenticate current Session every poll/call; do not allow filters.
- [ ] Return `{ messages: [], nextCursor, hasMore: false, timedOut: true }` on timeout; never throw an operation error merely for timeout.
- [ ] Add MCP `wait_messages`; replace legacy CLI wait parsing and rendering with cursor-required current-Inbox semantics.
- [ ] Run focused wait tests and `bun run test`; commit this Issue alone.

### Issue 6: Ship protocol documentation, shared Skill, and smoke coverage

**Files:**

- Modify: `packages/integrations/src/skills/document.ts`, `packages/integrations/test/skills.test.ts`
- Modify: `README.md`, `site/cli.md`, `site/concepts.md`, `packages/cli/test/mvp-smoke.test.ts`, `packages/cli/test/docs-links.test.ts`
- Modify durable docs only when shipped behavior differs from the approved design.

- [ ] Add failing Skill/docs tests for the protocol-only guidance: startup drains Inbox, retains `nextCursor`, waits only by human/Profile choice, and uses `latest` only for an explicit intentional tail start.
- [ ] Update docs to describe public envelope, cursor list, cursor-only wait, timeout success, payload/page limits, and notification-only `failed` without prescribing worker/reviewer/fan-out behavior.
- [ ] Extend fake-runtime smoke coverage through paginated list, cursor handoff, wait timeout/arrival, and public-output redaction.
- [ ] Run `bun test packages/integrations/test/skills.test.ts packages/cli/test/mvp-smoke.test.ts packages/cli/test/docs-links.test.ts`, `bun run docs:build`, and the full baseline; commit this Issue alone.

### Issue 7: Root-only `asem run` P0 and attach exit correctness

**Files:**

- Modify: `packages/cli/src/parse.ts`, `packages/cli/src/run.ts`, `packages/cli/src/render.ts`, `packages/cli/src/usage.ts`
- Modify: `packages/cli/src/io.ts` only if TTY/attach execution needs injection
- Test: `packages/cli/test/parse.test.ts`, `packages/cli/test/run.test.ts`, `packages/cli/test/runtime-adapters.test.ts`
- Modify after implementation: `README.md`, `site/cli.md`, `docs/designs/asem-session-manager-design.md`

**Interfaces:**

- `asem run <agent> [--name <name>] [--prompt <text>] [--no-attach]`.
- The command delegates to existing `createSession` with `root: true`. It has no `--parent` or ambient-parent behavior.

- [ ] Write failing parser/runner tests for exact configured Agent Template lookup, default name equal to agent, duplicate-name error, root input, and the only three supported flags.
- [ ] Write failing prompt tests: stable English CLI-local bootstrap plus optional `## User request` only when `--prompt` exists.
- [ ] Implement the thin CLI composition; do not add a new ops lifecycle operation or MCP tool.
- [ ] Add TTY auto-attach after successful creation unless `--no-attach` or non-TTY. On attach failure, preserve the Session and return a nonzero exit code.
- [ ] Fix existing `asem session attach` to propagate the attach process exit status. Test success/failure with the injected `AttachRunner`.
- [ ] Run focused CLI tests and the full baseline; update user-facing docs only after the command ships; commit this Issue alone.

## Mikan Issue mapping and dependency order

1. MIK-059 (Issue 1) → MIK-060 (Issue 2) → MIK-061 (Issue 3).
2. MIK-062 (Issue 4) and MIK-063 (Issue 5) may proceed independently after MIK-061.
3. MIK-064 (Issue 6) depends on MIK-062 and MIK-063.
4. MIK-065 (Issue 7) depends on MIK-064 so its bootstrap teaches the shipped protocol.

Each Issue requires a separate implementation Session, independent review Session, focused test run, and PR before its dependent Issue starts.

## Final integration gate

- [ ] Run `bun run typecheck`.
- [ ] Run `bun run test`.
- [ ] Run `bun run check`.
- [ ] Run `bun run docs:build`.
- [ ] Run the fake-runtime CLI/MCP smoke flow and verify no public result contains token material, `formattedBody`, location metadata, or sequence.
- [ ] Review each Issue independently before merging its PR; use GitButler for every version-control mutation.
