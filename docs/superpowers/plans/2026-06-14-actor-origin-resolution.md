# Actor Origin Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize mutating-operation actor/origin resolution and mux execution setup in `@asem/ops` while preserving existing CLI/MCP/TUI semantics.

**Architecture:** Add a small `resolveMutationActor` helper in `packages/ops/src/context.ts` for send/close/delete-style operations that allow human local trust. Add `packages/ops/src/mux-execution.ts` to build token-scoped redactor, redacted logger, and `SequenceEngine`. Migrate `send-message.ts`, `close-session.ts`, and `delete-session.ts`; leave `report_parent` as always-current and keep `create_session` parent resolution semantics separate.

**Tech Stack:** TypeScript, Bun test, `@asem/core` ports/types, `@asem/runtime` `SequenceEngine` and redactors, GitButler (`but`) for VCS.

---

### Task 1: Add actor helper tests

**Files:**
- Modify: `packages/ops/test/context.test.ts`
- Modify: `packages/ops/src/context.ts`

- [ ] **Step 1: Add failing tests for `resolveMutationActor`**

Append a `resolveMutationActor` describe block to `packages/ops/test/context.test.ts`:

```ts
import { resolveMutationActor } from "../src/context.ts";

const CURRENT_TOKEN = "tok-current";

function actorDeps(overrides: {
  store?: FakeStore;
  currentSessionResolver?: FakeCurrentSessionResolver;
} = {}) {
  const store = overrides.store ?? new FakeStore();
  return {
    store,
    currentSessionResolver:
      overrides.currentSessionResolver ?? new FakeCurrentSessionResolver(null),
  };
}

describe("resolveMutationActor", () => {
  test("operator origin skips current-session resolution", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const result = await resolveMutationActor(deps, scopeA, {
      cwd: scopeA.worktreeRoot,
      origin: "operator",
    });

    expectOk(result).toEqual({ kind: "operator", session: null, token: null });
  });

  test("agent origin requires and returns the verified current Session", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const actor = expectOk(
      await resolveMutationActor(deps, scopeA, {
        cwd: scopeA.worktreeRoot,
        origin: "agent",
      }),
    );

    expect(actor.kind).toBe("agent");
    expect(actor.session?.id).toBe(me.id);
    expect(actor.token).toBe(CURRENT_TOKEN);
  });

  test("unset origin with no pointer is anonymous human local trust", async () => {
    const actor = expectOk(
      await resolveMutationActor(actorDeps(), scopeA, {
        cwd: scopeA.worktreeRoot,
      }),
    );

    expect(actor).toEqual({ kind: "human-anon", session: null, token: null });
  });

  test("unset origin with pointer verifies and returns the current Session", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);
    const deps = actorDeps({
      store,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: me.id,
        token: CURRENT_TOKEN,
      }),
    });

    const actor = expectOk(
      await resolveMutationActor(deps, scopeA, { cwd: scopeA.worktreeRoot }),
    );

    expect(actor.kind).toBe("human-current");
    expect(actor.session?.id).toBe(me.id);
    expect(actor.token).toBe(CURRENT_TOKEN);
  });

  test("token and scope errors are preserved", async () => {
    const store = new FakeStore();
    const me = makeSession({ tokenHash: hashToken(CURRENT_TOKEN) });
    store.sessions.push(me);

    expectErr(
      await resolveMutationActor(
        actorDeps({
          store,
          currentSessionResolver: new FakeCurrentSessionResolver({
            sessionId: me.id,
            token: "wrong",
          }),
        }),
        scopeA,
        { cwd: scopeA.worktreeRoot },
      ),
      "invalid_session_token",
    );

    expectErr(
      await resolveMutationActor(
        actorDeps({
          store,
          currentSessionResolver: new FakeCurrentSessionResolver({
            sessionId: me.id,
            token: CURRENT_TOKEN,
            scope: scopeB,
          }),
        }),
        scopeA,
        { cwd: scopeA.worktreeRoot },
      ),
      "scope_mismatch",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```sh
bun test packages/ops/test/context.test.ts
```

Expected: fail because `resolveMutationActor` is not exported.

- [ ] **Step 3: Implement helper in `context.ts`**

Add types and helpers:

```ts
export interface VerifiedCurrentSession {
  session: Session;
  token: string;
}

export type MutationActor =
  | { kind: "operator"; session: null; token: null }
  | { kind: "human-anon"; session: null; token: null }
  | { kind: "human-current"; session: Session; token: string }
  | { kind: "agent"; session: Session; token: string };

export async function authenticateCurrentSessionWithToken(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
): Promise<OperationResult<VerifiedCurrentSession>> {
  const ref = await deps.currentSessionResolver.resolve(scope);
  if (ref === null) {
    return err(
      operationError(
        "current_session_not_found",
        "no current Session; run `asem init-session` or pass an explicit target",
      ),
    );
  }
  if (ref.scope !== undefined && !sameScope(ref.scope, scope)) {
    return err(
      operationError(
        "scope_mismatch",
        "current Session belongs to a different workspace or worktree",
        { sessionId: ref.sessionId },
      ),
    );
  }
  const session = await deps.store.getSessionById(scope, ref.sessionId);
  if (session === null) {
    return err(
      operationError(
        "session_not_found",
        "current Session is not registered in this scope",
        { sessionId: ref.sessionId },
      ),
    );
  }
  if (!verifyToken(ref.token, session.tokenHash)) {
    return err(
      operationError(
        "invalid_session_token",
        "current Session token failed verification",
        { sessionId: ref.sessionId },
      ),
    );
  }
  return ok({ session, token: ref.token });
}

export async function resolveMutationActor(
  deps: { store: Store; currentSessionResolver: CurrentSessionResolver },
  scope: EffectiveScope,
  ctx: OpContext,
): Promise<OperationResult<MutationActor>> {
  if (ctx.origin === "operator") {
    return ok({ kind: "operator", session: null, token: null });
  }
  if (ctx.origin === "agent") {
    const auth = await authenticateCurrentSessionWithToken(deps, scope);
    if (!auth.ok) return auth;
    return ok({ kind: "agent", session: auth.value.session, token: auth.value.token });
  }

  const ref = await deps.currentSessionResolver.resolve(scope);
  if (ref === null) {
    return ok({ kind: "human-anon", session: null, token: null });
  }
  const auth = await authenticateCurrentSessionWithToken(deps, scope);
  if (!auth.ok) return auth;
  return ok({
    kind: "human-current",
    session: auth.value.session,
    token: auth.value.token,
  });
}
```

Then change `authenticateCurrentSession` to delegate:

```ts
export async function authenticateCurrentSession(...): Promise<OperationResult<Session>> {
  const auth = await authenticateCurrentSessionWithToken(deps, scope);
  if (!auth.ok) return auth;
  return ok(auth.value.session);
}
```

- [ ] **Step 4: Run helper tests**

Run:

```sh
bun test packages/ops/test/context.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Use GitButler:

```sh
but commit mik-039-actor-origin-resolution -m "Add mutation actor resolution helper"
```

---

### Task 2: Add mux execution helper

**Files:**
- Create: `packages/ops/src/mux-execution.ts`
- Modify: `packages/ops/src/index.ts`
- Test via existing send/close tests in later tasks.

- [ ] **Step 1: Create helper module**

Create `packages/ops/src/mux-execution.ts`:

```ts
import type { Logger, Redactor, TemplateRunner } from "@asem/core";
import {
  createRedactor,
  noopRedactor,
  SequenceEngine,
  withRedaction,
} from "@asem/runtime";

export interface MuxExecutionDeps {
  templateRunner: TemplateRunner;
  logger?: Logger;
  redactor?: Redactor;
}

export function muxExecutionFor(
  deps: MuxExecutionDeps,
  token: string | null,
): { redactor: Redactor; logger?: Logger; engine: SequenceEngine } {
  const redactor =
    token === null ? (deps.redactor ?? noopRedactor) : createRedactor([token]);
  const logger =
    deps.logger === undefined ? undefined : withRedaction(deps.logger, redactor);
  return {
    redactor,
    logger,
    engine: new SequenceEngine({
      runner: deps.templateRunner,
      redactor,
      logger,
    }),
  };
}
```

- [ ] **Step 2: Export helper if needed**

If tests or other packages need it, export from `packages/ops/src/index.ts`. Prefer keeping it package-local unless a test imports it directly.

- [ ] **Step 3: Typecheck**

Run:

```sh
bun run typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```sh
but commit mik-039-actor-origin-resolution -m "Add mux execution helper"
```

---

### Task 3: Migrate send/close/delete to helpers

**Files:**
- Modify: `packages/ops/src/operations/send-message.ts`
- Modify: `packages/ops/src/operations/close-session.ts`
- Modify: `packages/ops/src/operations/delete-session.ts`
- Test: `packages/ops/test/send-message.test.ts`
- Test: `packages/ops/test/close-session.test.ts`
- Test: `packages/ops/test/delete-session.test.ts`

- [ ] **Step 1: Migrate send_message**

In `send-message.ts`:

- Replace imports of `authenticateCurrentSession`, `createRedactor`, `noopRedactor`, `SequenceEngine`, and `withRedaction` where no longer needed.
- Import `resolveMutationActor` from `../context.ts`.
- Import `muxExecutionFor` from `../mux-execution.ts`.
- Replace inline auth ladder with:

```ts
const actorResult = await resolveMutationActor(deps, scope, ctx);
if (!actorResult.ok) return actorResult;
const actor = actorResult.value;
const sender = actor.session;
```

- Pass `actor.token` to `deliver` instead of a redactor:

```ts
token: actor.token,
```

- Change `deliver` params from `redactor: Redactor` to `token: string | null`.
- Inside `deliver`, create mux execution once:

```ts
const { redactor, logger, engine } = muxExecutionFor(deps, token);
```

- Remove local `redactorFor` function.

- [ ] **Step 2: Run send tests**

```sh
bun test packages/ops/test/send-message.test.ts
```

Expected: pass.

- [ ] **Step 3: Migrate close_session**

In `close-session.ts`:

- Import `resolveMutationActor` and `muxExecutionFor`.
- Replace inline auth ladder with:

```ts
const actorResult = await resolveMutationActor(deps, scope, ctx);
if (!actorResult.ok) return actorResult;
const actor = actorResult.value;
```

- Replace local redactor/logger/engine setup with:

```ts
const { logger, engine } = muxExecutionFor(deps, actor.token);
```

- Remove local `redactorFor` function and unused runtime imports.

- [ ] **Step 4: Run close tests**

```sh
bun test packages/ops/test/close-session.test.ts
```

Expected: pass.

- [ ] **Step 5: Migrate delete_session auth**

In `delete-session.ts`:

- Import `resolveMutationActor`.
- Replace inline auth ladder with:

```ts
const actorResult = await resolveMutationActor(deps, scope, ctx);
if (!actorResult.ok) return actorResult;
```

No token/log helper needed for delete.

- [ ] **Step 6: Run delete tests**

```sh
bun test packages/ops/test/delete-session.test.ts
```

Expected: pass.

- [ ] **Step 7: Run combined ops tests**

```sh
bun test packages/ops/test/context.test.ts packages/ops/test/send-message.test.ts packages/ops/test/close-session.test.ts packages/ops/test/delete-session.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```sh
but commit mik-039-actor-origin-resolution -m "Use actor and mux helpers in mutations"
```

---

### Task 4: Validate and merge

**Files:**
- All changed files.

- [ ] **Step 1: LSP diagnostics**

Run LSP diagnostics on:

- `packages/ops/src/context.ts`
- `packages/ops/src/mux-execution.ts`
- `packages/ops/src/operations/send-message.ts`
- `packages/ops/src/operations/close-session.ts`
- `packages/ops/src/operations/delete-session.ts`

Expected: 0 diagnostics.

- [ ] **Step 2: Full checks**

Run:

```sh
bun run typecheck
bun run test
bunx biome check docs/superpowers/specs/2026-06-14-actor-origin-resolution-design.md docs/superpowers/plans/2026-06-14-actor-origin-resolution.md packages/ops/src/context.ts packages/ops/src/mux-execution.ts packages/ops/src/operations/send-message.ts packages/ops/src/operations/close-session.ts packages/ops/src/operations/delete-session.ts packages/ops/test/context.test.ts packages/ops/test/send-message.test.ts packages/ops/test/close-session.test.ts packages/ops/test/delete-session.test.ts
```

Expected: typecheck/test pass. Biome may show existing `noNonNullAssertion` warnings in tests; no new errors.

- [ ] **Step 3: Create PR**

```sh
but push mik-039-actor-origin-resolution
gh pr create --base main --head mik-039-actor-origin-resolution --title "Consolidate actor origin resolution in ops" --body-file /tmp/pr-mik039.md
```

- [ ] **Step 4: Merge PR**

```sh
gh pr merge <number> --merge --delete-branch
but clean --pull --status-after
```

- [ ] **Step 5: Complete MIK-039**

Move `MIK-039` to completed with validation notes.
