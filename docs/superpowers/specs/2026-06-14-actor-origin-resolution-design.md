# Actor/origin resolution and mux execution helper design

## Context

Claude's architecture review identified repeated trust and mux-execution wiring inside `@asem/ops`:

- `send_message`, `close_session`, and `delete_session` each re-implement the same `OpContext.origin` ladder.
- `send_message` and `close_session` both build a token-scoped redactor, redacted logger, and `SequenceEngine` locally.
- `report_parent` and `create_session` have related but not identical semantics, so folding every operation into one broad actor abstraction risks hiding important differences.

This slice keeps asem's domain model unchanged. It only deepens the `@asem/ops` seam around actor trust and mux command execution.

## Goals

- Localize ADR 0003 origin semantics for mutating operations that allow human local trust.
- Preserve existing behavior for CLI, MCP, and TUI surfaces.
- Keep `operator` origin as a trusted surface context marker, not an operation input.
- Keep `report_parent` as always-current-Session and do not dilute that rule.
- Reduce duplicated token redaction / logger / `SequenceEngine` setup.
- Add tests at the helper seam so future trust-rule changes are localized.

## Non-goals

- No new Session, Message, Report, Template, Command Sequence, Agent, or Multiplexer semantics.
- No broad operation registry.
- No changes to MCP/CLI/TUI input schemas.
- No rewrite of create-session parent semantics beyond using clearer helper names where safe.
- No durable auth/session state changes.

## Design

### 1. Add a small actor helper

Add a helper in `packages/ops/src/context.ts`, tentatively named `resolveMutationActor`.

Inputs:

- `deps`: store + current-session resolver
- `scope`: resolved Effective Scope
- `ctx`: trusted `OpContext`

Output shape:

```ts
type MutationActor =
  | { kind: "operator"; session: null; token: null }
  | { kind: "human-anon"; session: null; token: null }
  | { kind: "human-current"; session: Session; token: string }
  | { kind: "agent"; session: Session; token: string };
```

Semantics:

- `ctx.origin === "operator"`: do not resolve current Session; return `operator`.
- `ctx.origin === "agent"`: authenticate current Session; return `agent` with verified token.
- origin unset: resolve current-session pointer.
  - no pointer: return `human-anon`.
  - pointer exists: authenticate current Session; return `human-current` with verified token.

The helper needs token material for redaction. `authenticateCurrentSession` currently returns only `Session`, so this design adds a sibling helper that returns the verified Session plus token. `authenticateCurrentSession` can delegate to it and keep its public return type for existing read/report callers.

### 2. Use the helper in send/close/delete

- `send_message`: actor session becomes `fromSession` except for `operator` / `human-anon`; actor token feeds mux redaction.
- `close_session`: actor token feeds mux redaction. No attribution changes.
- `delete_session`: calls the helper only for auth side effects. No mux execution helper needed.

This removes the repeated origin ladder while preserving behavior.

### 3. Add mux execution helper

Add a small helper under `packages/ops/src/`, tentatively `mux-execution.ts`.

Input:

- deps with `templateRunner`, optional `logger`, optional fallback `redactor`
- token `string | null`

Output:

```ts
{
  redactor: Redactor;
  logger?: Logger;
  engine: SequenceEngine;
}
```

Semantics:

- token present: use `createRedactor([token])`.
- token absent: use injected fallback redactor or `noopRedactor`.
- logger present: wrap with `withRedaction`.
- `SequenceEngine` receives the redactor and redacted logger.

Use this helper in `send_message` and `close_session`. `create_session` already has a freshly generated token and slightly different sequencing; it may adopt this helper only if it stays obviously clearer.

## Testing

Add helper-level tests in `packages/ops/test/context.test.ts` for:

- operator origin skips current-session resolver and returns no Session/token.
- agent origin requires and verifies current Session.
- unset origin + no pointer returns anonymous human.
- unset origin + pointer verifies current Session and returns token.
- scope mismatch / invalid token errors remain unchanged.

Update operation tests to assert behavior remains unchanged:

- TUI/operator send remains unattributed even with a current Session pointer.
- agent send remains attributed.
- close/delete with operator origin ignore stale current-session pointer.
- close redacts token in mux errors/logs as before.

Run:

```sh
bun test packages/ops/test/context.test.ts packages/ops/test/send-message.test.ts packages/ops/test/close-session.test.ts packages/ops/test/delete-session.test.ts
bun run typecheck
bun run test
```

## Rollout

Implement as one small refactor PR:

1. Add helper tests and watch them fail.
2. Add verified-current-token helper and mutation actor helper.
3. Add mux execution helper.
4. Migrate send/close/delete.
5. Run full validation.

No ADR is needed. This implements and localizes existing accepted decisions rather than changing them.
