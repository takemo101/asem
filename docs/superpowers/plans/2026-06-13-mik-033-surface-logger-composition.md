# MIK-033 Surface-Specific Logger Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real runtime dependency composition select logger implementations by surface so CLI keeps stderr diagnostics while MCP and TUI are silent by default.

**Architecture:** Keep `Logger` as the shared `@asem/core` port. Add a small surface-aware logger factory in `packages/cli/src/runtime/adapters.ts`, require `createRuntimeDeps({ surface })` in `packages/cli/src/main.ts`, and remove the TUI cockpit-local logger suppression now that the TUI receives safe deps from the composition root.

**Tech Stack:** TypeScript, Bun test, existing `@asem/core` `Logger` port, GitButler `but` workflow.

---

## File Structure

- Modify `packages/cli/src/runtime/adapters.ts`
  - Add `RuntimeSurface` type.
  - Add a small output-injection seam for `ConsoleLogger` so tests can prove CLI emits without monkey-patching `process.stderr`.
  - Add internal silent logger and exported `createSurfaceLogger(surface)`.
- Modify `packages/cli/src/main.ts`
  - Change `createRuntimeDeps()` to `createRuntimeDeps({ surface })`.
  - Determine surface from `argv` before building deps.
- Modify `packages/tui/src/cockpit.ts`
  - Remove local `silentLogger` and `withoutTerminalLogger`.
  - Pass `deps` directly to `sendMessage`, `closeSession`, and `deleteSession`.
- Modify `packages/cli/test/runtime-adapters.test.ts`
  - Add focused logger factory tests.
- Modify `packages/tui/test/app.test.ts`
  - Replace the old cockpit-level arbitrary logger suppression test with a test documenting that the cockpit now uses the provided deps logger directly.
- Optional validation only: no docs should change in this implementation slice unless the implementation differs from ADR 0006.

---

### Task 1: Add surface logger factory tests

**Files:**
- Modify: `packages/cli/test/runtime-adapters.test.ts`
- Modify later: `packages/cli/src/runtime/adapters.ts`

- [ ] **Step 1: Write failing tests for CLI/MCP/TUI logger policy**

Add imports at the top of `packages/cli/test/runtime-adapters.test.ts`:

```ts
import type { LogFields } from "@asem/core";
```

Update the existing adapters import from:

```ts
import { FileCurrentSessionResolver } from "../src/runtime/adapters.ts";
```

to:

```ts
import {
  createSurfaceLogger,
  FileCurrentSessionResolver,
} from "../src/runtime/adapters.ts";
```

Append these tests after the existing `FileCurrentSessionResolver` describe block:

```ts
describe("createSurfaceLogger", () => {
  test("cli emits stderr JSON through the injected writer", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("cli", {
      writeStderr: (line) => lines.push(line),
    });

    logger.info("created Session", { sessionId: "s1" });

    expect(lines).toEqual([
      JSON.stringify({
        level: "info",
        message: "created Session",
        sessionId: "s1",
      }) + "\n",
    ]);
  });

  test("cli logger applies the provided redactor before writing", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("cli", {
      redactor: { redact: (value) => value.replaceAll("sample-sensitive-value", "[redacted]") },
      writeStderr: (line) => lines.push(line),
    });

    logger.error("failed", { sample: "sample-sensitive-value" } satisfies LogFields);

    expect(lines.join("")).toContain("[redacted]");
    expect(lines.join("")).not.toContain("sample-sensitive-value");
  });

  test("mcp is silent by default", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("mcp", {
      writeStderr: (line) => lines.push(line),
    });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");

    expect(lines).toEqual([]);
  });

  test("tui is silent by default", () => {
    const lines: string[] = [];
    const logger = createSurfaceLogger("tui", {
      writeStderr: (line) => lines.push(line),
    });

    logger.info("closed Session", { sessionId: "s1" });
    logger.warn("mux close failed", { sessionId: "s1" });

    expect(lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
bun test packages/cli/test/runtime-adapters.test.ts
```

Expected: FAIL because `createSurfaceLogger` is not exported from `packages/cli/src/runtime/adapters.ts`.

- [ ] **Step 3: Implement minimal logger factory**

In `packages/cli/src/runtime/adapters.ts`, replace the current `ConsoleLogger` block with this implementation. Keep the surrounding `passthroughRedactor` export unchanged.

```ts
export type RuntimeSurface = "cli" | "mcp" | "tui";

export interface ConsoleLoggerOptions {
  redactor?: Redactor;
  writeStderr?: (line: string) => void;
}

/** stderr JSON logger. Token material is never passed in by operations. */
export class ConsoleLogger implements Logger {
  private readonly redactor: Redactor;
  private readonly writeStderr: (line: string) => void;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.redactor = options.redactor ?? passthroughRedactor;
    this.writeStderr =
      options.writeStderr ?? ((line) => process.stderr.write(line));
  }

  private write(level: string, message: string, fields?: LogFields): void {
    const line = JSON.stringify(
      fields === undefined ? { level, message } : { level, message, ...fields },
    );
    this.writeStderr(`${this.redactor.redact(line)}\n`);
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface SurfaceLoggerOptions {
  redactor?: Redactor;
  writeStderr?: (line: string) => void;
}

export function createSurfaceLogger(
  surface: RuntimeSurface,
  options: SurfaceLoggerOptions = {},
): Logger {
  switch (surface) {
    case "cli":
      return new ConsoleLogger(options);
    case "mcp":
    case "tui":
      return silentLogger;
    default: {
      const _never: never = surface;
      return _never;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```sh
bun test packages/cli/test/runtime-adapters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck for the package**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```sh
but status -fv
but commit mik-033-surface-logger-composition --create -m "Add surface logger factory" --no-hooks
```

Before committing, confirm `but status -fv` shows only `packages/cli/src/runtime/adapters.ts` and `packages/cli/test/runtime-adapters.test.ts` as unassigned changes.

---

### Task 2: Require surface selection in real runtime deps

**Files:**
- Modify: `packages/cli/src/main.ts`
- Test through: `bun run typecheck`, `bun test packages/cli/test/runtime-adapters.test.ts packages/cli/test/tui.test.ts packages/mcp/test/server.test.ts`

- [ ] **Step 1: Update imports in `packages/cli/src/main.ts`**

Change the import from `./runtime/adapters.ts` to include the new factory and type and remove `ConsoleLogger`:

```ts
import {
  createSurfaceLogger,
  FileConfigLoader,
  FileCurrentSessionResolver,
  GitScopeResolver,
  NodeFileSystem,
  NodeTemplateRunner,
  passthroughRedactor,
  randomTokenGenerator,
  type RuntimeSurface,
  storedStatusLivenessProbe,
  systemClock,
  uuidIdGenerator,
} from "./runtime/adapters.ts";
```

- [ ] **Step 2: Change `createRuntimeDeps` signature and logger wiring**

Replace:

```ts
/** Assemble the full {@link OpsDeps} bundle backed by the global SQLite DB. */
export async function createRuntimeDeps(): Promise<OpsDeps> {
```

with:

```ts
export interface RuntimeDepsOptions {
  surface: RuntimeSurface;
}

/** Assemble the full {@link OpsDeps} bundle backed by the global SQLite DB. */
export async function createRuntimeDeps(
  options: RuntimeDepsOptions,
): Promise<OpsDeps> {
```

Then replace:

```ts
    logger: new ConsoleLogger(),
```

with:

```ts
    logger: createSurfaceLogger(options.surface, {
      redactor: passthroughRedactor,
    }),
```

- [ ] **Step 3: Add a tiny surface resolver in `packages/cli/src/main.ts`**

Add this function above `main`:

```ts
function surfaceForArgv(argv: readonly string[]): RuntimeSurface {
  switch (argv[0]) {
    case "mcp":
      return "mcp";
    case "tui":
      return "tui";
    default:
      return "cli";
  }
}
```

- [ ] **Step 4: Build deps with the resolved surface**

Replace this line in `main`:

```ts
  const deps = await createRuntimeDeps();
```

with:

```ts
  const deps = await createRuntimeDeps({ surface: surfaceForArgv(argv) });
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```sh
bun run typecheck
bun test packages/cli/test/runtime-adapters.test.ts packages/cli/test/tui.test.ts packages/mcp/test/server.test.ts
```

Expected: all pass. If typecheck finds another call to `createRuntimeDeps()` without options, update that call to pass an explicit surface.

- [ ] **Step 6: Commit Task 2**

Run:

```sh
but status -fv
but commit mik-033-surface-logger-composition -m "Select runtime logger by surface" --no-hooks
```

Before committing, confirm `but status -fv` shows only `packages/cli/src/main.ts` as an unassigned change.

---

### Task 3: Remove TUI cockpit-local logger suppression

**Files:**
- Modify: `packages/tui/src/cockpit.ts`
- Modify: `packages/tui/test/app.test.ts`

- [ ] **Step 1: Replace the old suppression test with a new responsibility test**

In `packages/tui/test/app.test.ts`, replace the test named:

```ts
test("close does not emit operation logs into the TUI terminal", async () => {
```

through its closing `});` with:

```ts
test("close uses the provided deps logger; surface composition supplies the TUI-safe logger", async () => {
  const store = new FakeStore();
  const logger = new MemoryLogger();
  store.sessions.push(makeSession({ id: "s1", status: "running" }));
  const env = makeEnv();
  const state = createCockpitState(env, snapshot([...store.sessions]));
  const app = new CockpitApp(
    makeOpsDeps({ store, logger }),
    env,
    state,
    new FakeHost(),
  );

  await app.dispatch({ type: "requestClose" });
  const result = await app.dispatch({ type: "confirm" });

  expect(result.error).toBeUndefined();
  expect(store.sessions[0]!.status).toBe("closed");
  expect(logger.entries.some((entry) => entry.message === "closed Session")).toBe(
    true,
  );
});
```

This is intentionally the opposite of the old assertion: it proves the TUI app no longer owns logger suppression. The runtime TUI surface must pass a silent logger.

- [ ] **Step 2: Run test to verify it fails before implementation**

Run:

```sh
bun test packages/tui/test/app.test.ts --grep "surface composition supplies"
```

Expected: FAIL because `withoutTerminalLogger` still strips the provided logger.

- [ ] **Step 3: Remove suppression from `packages/tui/src/cockpit.ts`**

Remove `Logger` from the import list at the top of `packages/tui/src/cockpit.ts`:

```ts
import type {
  AttachCommand,
  Message,
  OperationResult,
  Session,
} from "@asem/core";
```

Delete this whole block:

```ts
const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * TUI draws directly into the terminal, so operation logs must not write JSON
 * lines to stderr/stdout while the renderer owns the screen. Keep structured
 * errors in-band through the view-model instead.
 */
function withoutTerminalLogger(deps: EffectDeps): EffectDeps {
  return { ...deps, logger: silentLogger };
}
```

Replace each mutation call to pass `deps` directly:

```ts
const result = await sendMessage(
  deps,
  { toSessionId: effect.sessionId, body: effect.body },
  { ...ctx, origin: "operator" },
);
```

```ts
const result = await closeSession(
  deps,
  { id: effect.sessionId },
  {
    ...ctx,
    origin: "operator",
  },
);
```

```ts
const result = await deleteSession(
  deps,
  { id: effect.sessionId, force: true },
  { ...ctx, origin: "operator" },
);
```

- [ ] **Step 4: Run focused TUI tests**

Run:

```sh
bun test packages/tui/test/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run grep to ensure the workaround is gone**

Run:

```sh
rg -n "withoutTerminalLogger|silentLogger" packages/tui/src packages/tui/test
```

Expected: no matches for the removed TUI-local workaround.

- [ ] **Step 6: Commit Task 3**

Run:

```sh
but status -fv
but commit mik-033-surface-logger-composition -m "Remove TUI-local logger suppression" --no-hooks
```

Before committing, confirm `but status -fv` shows only `packages/tui/src/cockpit.ts` and `packages/tui/test/app.test.ts` as unassigned changes.

---

### Task 4: Final validation and issue note

**Files:**
- No code files expected unless validation finds an issue.
- Update through mikan MCP: `MIK-033` completion/progress note after implementation.

- [ ] **Step 1: Run targeted checks**

Run:

```sh
bun test packages/cli/test/runtime-adapters.test.ts packages/tui/test/app.test.ts packages/cli/test/tui.test.ts packages/mcp/test/server.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full typecheck and tests**

Run:

```sh
bun run typecheck
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run changed-file biome check**

Run:

```sh
bunx biome check packages/cli/src/runtime/adapters.ts packages/cli/src/main.ts packages/cli/test/runtime-adapters.test.ts packages/tui/src/cockpit.ts packages/tui/test/app.test.ts
```

Expected: PASS. If full `bun run check` is run, known repository baseline lint may still fail outside this slice; report that separately.

- [ ] **Step 4: Append an implementation note to MIK-033**

Use the mikan MCP tool `mikan_append_issue` with:

```json
{
  "id": "MIK-033",
  "section": "Implementation notes",
  "source": "implementation-agent",
  "body": "Implemented surface-specific logger composition. CLI uses stderr JSON logging; MCP and TUI receive silent loggers by default; TUI-local withoutTerminalLogger suppression was removed. Validation: targeted tests passed; bun run typecheck passed; bun run test passed; changed-file biome check passed."
}
```

- [ ] **Step 5: Commit any final validation/test cleanup**

If Step 3 or Step 4 created tracked changes, run:

```sh
but status -fv
but commit mik-033-surface-logger-composition -m "Finalize MIK-033 logger composition" --no-hooks
```

Before committing, confirm `but status -fv` shows only final validation cleanup or tracked mikan note changes. If there are no tracked changes, skip this commit.

---

## Self-Review

- Spec coverage: The plan implements `createRuntimeDeps({ surface })`, CLI/MCP/TUI logger mapping, removal of TUI-local suppression, logger factory tests, composition seam changes, and validation. ADR/docs were already written and committed before this plan.
- Placeholder scan: The only angle-bracket placeholders are GitButler change IDs and validation paste text that must come from the worker's local `but status` / command output. The plan explicitly instructs workers not to hardcode them.
- Type consistency: `RuntimeSurface`, `createSurfaceLogger`, `ConsoleLoggerOptions`, and `SurfaceLoggerOptions` are introduced before use. `createRuntimeDeps({ surface })` matches the design accepted in ADR 0006.
