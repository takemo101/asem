# Doctor Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `asem doctor` to report local availability of builtin Agent and Multiplexer command-line tools.

**Architecture:** Add a small executable lookup port to `@asem/core`, implement the diagnostic semantics in `@asem/ops`, and expose it through the CLI parser/renderer. The command is read-only and returns exit code 0 for missing executables, missing config, and invalid config diagnostics.

**Tech Stack:** TypeScript, Bun tests, `@asem/core` operation contracts, `@asem/ops` handlers, `@asem/cli` parser/rendering, GitButler.

---

## File structure

- `packages/core/src/ports.ts`: add `ExecutableResolver` port.
- `packages/core/src/types/operations.ts`: add `doctorInputSchema`, `DoctorOutput`, and related check types.
- `packages/ops/src/deps.ts`: add `executableResolver` to `OpsDeps`.
- `packages/ops/src/operations/doctor.ts`: new read-only operation.
- `packages/ops/src/index.ts`: export `doctor` and output types.
- `packages/ops/src/testing/fakes.ts`: add `FakeExecutableResolver` and default fake dependency.
- `packages/ops/test/doctor.test.ts`: new operation tests.
- `packages/cli/src/parse.ts`: parse `doctor [--json]`.
- `packages/cli/src/usage.ts`: root and focused doctor help.
- `packages/cli/src/render.ts`: render doctor text output.
- `packages/cli/src/run.ts`: dispatch doctor command.
- `packages/cli/src/runtime/adapters.ts`: add real `BunExecutableResolver`.
- `packages/cli/src/main.ts`: inject real executable resolver.
- `packages/cli/test/parse.test.ts`: parser tests.
- `packages/cli/test/run.test.ts`: CLI rendering/exit-code tests.
- `docs/README.md`: no change planned; doctor is CLI help/API surface only for this slice.

## Task 1: Add core contracts and fake dependency wiring

**Files:**
- Modify: `packages/core/src/ports.ts`
- Modify: `packages/core/src/types/operations.ts`
- Modify: `packages/ops/src/deps.ts`
- Modify: `packages/ops/src/testing/fakes.ts`

- [ ] **Step 1: Add the executable resolver port**

In `packages/core/src/ports.ts`, after `HostPaths`, add:

```ts
/** Resolves executable names from the host PATH without running them. */
export interface ExecutableResolver {
  which(name: string): Promise<string | null>;
}
```

- [ ] **Step 2: Add doctor operation types**

In `packages/core/src/types/operations.ts`, after profile input types, add:

```ts
// --- doctor ---------------------------------------------------------------

export const doctorInputSchema = z.object({}).strict();
export type DoctorInput = z.infer<typeof doctorInputSchema>;

export type DoctorConfigStatus =
  | { kind: "found"; configPath: string; workspaceId: string; defaultAgent: string; defaultMux: string }
  | { kind: "not_found" }
  | { kind: "invalid"; configPath: string; issues: readonly string[] };

export interface DoctorExecutableCheck {
  kind: "agent" | "mux";
  template: string;
  executable: string;
  status: "ok" | "missing";
  path: string | null;
  isDefault: boolean;
}

export interface DoctorOutput {
  config: DoctorConfigStatus;
  agents: DoctorExecutableCheck[];
  multiplexers: DoctorExecutableCheck[];
}
```

- [ ] **Step 3: Wire the port into OpsDeps**

In `packages/ops/src/deps.ts`, import `ExecutableResolver` and add to `OpsDeps`:

```ts
executableResolver: ExecutableResolver;
```

- [ ] **Step 4: Add fake resolver**

In `packages/ops/src/testing/fakes.ts`, import `ExecutableResolver`, then add before the bundle section:

```ts
export class FakeExecutableResolver implements ExecutableResolver {
  readonly paths = new Map<string, string>();
  readonly requests: string[] = [];

  set(name: string, path: string): this {
    this.paths.set(name, path);
    return this;
  }

  async which(name: string): Promise<string | null> {
    this.requests.push(name);
    return this.paths.get(name) ?? null;
  }
}
```

Add `executableResolver: new FakeExecutableResolver(),` to `makeOpsDeps()`.

- [ ] **Step 5: Run typecheck for expected compile issues**

Run:

```sh
bun run typecheck
```

Expected: fail until `createRuntimeDeps` is updated to provide `executableResolver`.

- [ ] **Step 6: Commit core seam**

```sh
but status -fv
but commit mik-045-doctor-command -m "Add doctor executable resolver seam"
```

## Task 2: Implement `@asem/ops` doctor operation with tests

**Files:**
- Create: `packages/ops/src/operations/doctor.ts`
- Create: `packages/ops/test/doctor.test.ts`
- Modify: `packages/ops/src/index.ts`

- [ ] **Step 1: Write failing operation tests**

Create `packages/ops/test/doctor.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { doctor } from "../src/operations/doctor.ts";
import {
  FakeConfigLoader,
  FakeExecutableResolver,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";

const CWD = "/repo";

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("doctor", () => {
  test("reports every builtin agent and mux executable", async () => {
    const executableResolver = new FakeExecutableResolver()
      .set("herdr", "/bin/herdr")
      .set("claude", "/bin/claude")
      .set("rmux", "/bin/rmux");
    const deps = makeOpsDeps({ executableResolver });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.multiplexers.map((c) => c.template)).toEqual([
      "herdr",
      "rmux",
      "tmux",
      "zellij",
    ]);
    expect(output.agents.map((c) => c.template)).toEqual([
      "agy",
      "claude",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(output.multiplexers.find((c) => c.template === "herdr")).toMatchObject({
      status: "ok",
      path: "/bin/herdr",
      isDefault: true,
    });
    expect(output.multiplexers.find((c) => c.template === "tmux")).toMatchObject({
      status: "missing",
      path: null,
      isDefault: false,
    });
    expect(output.agents.find((c) => c.template === "claude")).toMatchObject({
      status: "ok",
      path: "/bin/claude",
      isDefault: true,
    });
    expect(executableResolver.requests.sort()).toEqual([
      "agy",
      "claude",
      "codex",
      "herdr",
      "opencode",
      "pi",
      "rmux",
      "tmux",
      "zellij",
    ]);
  });

  test("marks configured defaults from a valid config", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({
        kind: "found",
        configPath: "/repo/.asem.yaml",
        config: makeConfig({
          mux: { default: "rmux", templates: {} },
          agent: { default: "pi", templates: {} },
        }),
      }),
      executableResolver: new FakeExecutableResolver().set("rmux", "/bin/rmux").set("pi", "/bin/pi"),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({
      kind: "found",
      configPath: "/repo/.asem.yaml",
      workspaceId: "ws_1",
      defaultAgent: "pi",
      defaultMux: "rmux",
    });
    expect(output.multiplexers.find((c) => c.template === "rmux")?.isDefault).toBe(true);
    expect(output.agents.find((c) => c.template === "pi")?.isDefault).toBe(true);
  });

  test("missing config still returns builtin checks", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
      executableResolver: new FakeExecutableResolver().set("zellij", "/bin/zellij"),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({ kind: "not_found" });
    expect(output.multiplexers.find((c) => c.template === "zellij")).toMatchObject({
      status: "ok",
      isDefault: false,
    });
  });

  test("invalid config still returns builtin checks and issues", async () => {
    const deps = makeOpsDeps({
      configLoader: new FakeConfigLoader({
        kind: "invalid",
        configPath: "/repo/.asem.yaml",
        issues: ["workspace.id is required"],
      }),
    });

    const output = expectOk(await doctor({}, { cwd: CWD }, deps));

    expect(output.config).toEqual({
      kind: "invalid",
      configPath: "/repo/.asem.yaml",
      issues: ["workspace.id is required"],
    });
    expect(output.agents).toHaveLength(6);
    expect(output.multiplexers).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```sh
bun test packages/ops/test/doctor.test.ts
```

Expected: fail because `doctor.ts` does not exist.

- [ ] **Step 3: Implement operation**

Create `packages/ops/src/operations/doctor.ts`:

```ts
import {
  type DoctorExecutableCheck,
  type DoctorInput,
  doctorInputSchema,
  type DoctorOutput,
  type OperationResult,
  operationError,
} from "@asem/core";
import type { OpContext, OpsDeps } from "../deps.ts";

const BUILTIN_MUX_EXECUTABLES = [
  ["herdr", "herdr"],
  ["rmux", "rmux"],
  ["tmux", "tmux"],
  ["zellij", "zellij"],
] as const;

const BUILTIN_AGENT_EXECUTABLES = [
  ["agy", "agy"],
  ["claude", "claude"],
  ["codex", "codex"],
  ["opencode", "opencode"],
  ["pi", "pi"],
] as const;

export async function doctor(
  input: DoctorInput,
  ctx: OpContext,
  deps: Pick<OpsDeps, "configLoader" | "executableResolver">,
): Promise<OperationResult<DoctorOutput>> {
  const parsed = doctorInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid doctor input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    };
  }

  const discovered = await deps.configLoader.load(ctx.cwd);
  const defaultMux = discovered.kind === "found" ? discovered.config.mux.default : null;
  const defaultAgent = discovered.kind === "found" ? discovered.config.agent.default : null;

  const config: DoctorOutput["config"] =
    discovered.kind === "found"
      ? {
          kind: "found",
          configPath: discovered.configPath,
          workspaceId: discovered.config.workspace.id,
          defaultAgent: discovered.config.agent.default,
          defaultMux: discovered.config.mux.default,
        }
      : discovered.kind === "invalid"
        ? {
            kind: "invalid",
            configPath: discovered.configPath,
            issues: discovered.issues,
          }
        : { kind: "not_found" };

  return {
    ok: true,
    value: {
      config,
      multiplexers: await checks("mux", BUILTIN_MUX_EXECUTABLES, defaultMux, deps),
      agents: await checks("agent", BUILTIN_AGENT_EXECUTABLES, defaultAgent, deps),
    },
  };
}

async function checks(
  kind: "agent" | "mux",
  entries: readonly (readonly [template: string, executable: string])[],
  defaultTemplate: string | null,
  deps: Pick<OpsDeps, "executableResolver">,
): Promise<DoctorExecutableCheck[]> {
  const out: DoctorExecutableCheck[] = [];
  for (const [template, executable] of entries) {
    const path = await deps.executableResolver.which(executable);
    out.push({
      kind,
      template,
      executable,
      status: path === null ? "missing" : "ok",
      path,
      isDefault: defaultTemplate === template,
    });
  }
  return out;
}
```

- [ ] **Step 4: Export operation**

In `packages/ops/src/index.ts`, add:

```ts
export { doctor } from "./operations/doctor.ts";
```

- [ ] **Step 5: Run operation tests**

Run:

```sh
bun test packages/ops/test/doctor.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit operation**

```sh
but status -fv
but commit mik-045-doctor-command -m "Add doctor operation"
```

## Task 3: Add CLI parse/help/render/dispatch

**Files:**
- Modify: `packages/cli/src/parse.ts`
- Modify: `packages/cli/src/usage.ts`
- Modify: `packages/cli/src/render.ts`
- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/test/parse.test.ts`
- Modify: `packages/cli/test/run.test.ts`

- [ ] **Step 1: Add parser tests**

In `packages/cli/test/parse.test.ts`, add tests under an existing parse describe block:

```ts
test("parseArgs doctor > maps doctor with optional json", () => {
  expect(parseArgs(["doctor"])).toEqual({
    kind: "command",
    command: { type: "doctor", json: false },
  });
  expect(parseArgs(["doctor", "--json"])).toEqual({
    kind: "command",
    command: { type: "doctor", json: true },
  });
});

test("parseArgs doctor > rejects unknown flags and extra args", () => {
  expect(parseArgs(["doctor", "--strict"]).kind).toBe("error");
  expect(parseArgs(["doctor", "extra"]).kind).toBe("error");
});
```

- [ ] **Step 2: Add CLI run tests**

In `packages/cli/test/run.test.ts`, add:

```ts
describe("runCli doctor", () => {
  test("renders availability and exits 0 even with missing executables", async () => {
    const { deps } = makeCliFixture();
    deps.executableResolver.set("herdr", "/bin/herdr");
    deps.executableResolver.set("claude", "/bin/claude");

    const io = new BufferIo();
    const code = await runCli({ argv: ["doctor"], cwd: CWD, deps, io });

    expect(code).toBe(EXIT_OK);
    const out = io.outText();
    expect(out).toContain("asem doctor");
    expect(out).toContain("Config: /repo/.asem.yaml");
    expect(out).toContain("Workspace: ws_1");
    expect(out).toContain("Multiplexers:");
    expect(out).toContain("ok       herdr");
    expect(out).toContain("missing  rmux");
    expect(out).toContain("Agents:");
    expect(out).toContain("ok       claude");
    expect(out).toContain("missing  codex");
  });

  test("renders json availability", async () => {
    const { deps } = makeCliFixture();
    deps.executableResolver.set("rmux", "/bin/rmux");

    const io = new BufferIo();
    const code = await runCli({ argv: ["doctor", "--json"], cwd: CWD, deps, io });

    expect(code).toBe(EXIT_OK);
    const parsed = JSON.parse(io.outText());
    expect(parsed.config.kind).toBe("found");
    expect(parsed.multiplexers.find((c: { template: string }) => c.template === "rmux")).toMatchObject({
      status: "ok",
      path: "/bin/rmux",
    });
  });
});
```

- [ ] **Step 3: Add command type and parser**

In `packages/cli/src/parse.ts`, add `| { type: "doctor"; json: boolean }` to `CliCommand`.

Add:

```ts
function parseDoctor(args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["json"], values: [] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  if (flags.value.positionals.length > 0) {
    return invalid("unexpected extra arguments", { extra: flags.value.positionals });
  }
  return {
    kind: "command",
    command: { type: "doctor", json: flags.value.booleans.has("json") },
  };
}
```

In the root command switch, route `doctor` to `parseDoctor(args.slice(1))`.

- [ ] **Step 4: Add help text**

In `packages/cli/src/usage.ts`, add `doctor` to root setup list and add:

```ts
const DOCTOR_USAGE = [
  "asem doctor — check local Agent and Multiplexer command availability",
  "",
  "usage:",
  "  asem doctor [--json]",
  "",
  "options:",
  "  --json    print machine-readable JSON",
  "",
  "examples:",
  "  asem doctor",
  "  asem doctor --json",
  "",
  "notes:",
  "  Missing executables are diagnostics, not command failures; exit code stays 0.",
  "  The first version checks builtin Agent and Multiplexer Template commands only.",
];
```

Add `case "doctor": return DOCTOR_USAGE;` in `usageFor`.

- [ ] **Step 5: Add renderer**

In `packages/cli/src/render.ts`, import `DoctorOutput` and add `renderDoctor(output: DoctorOutput): string[]` that prints config summary and two aligned sections. Use fixed padding so tests can assert substrings:

```ts
function renderDoctorCheck(check: DoctorExecutableCheck): string {
  const status = check.status.padEnd(8);
  const template = check.template.padEnd(8);
  const executable = check.executable.padEnd(8);
  const path = (check.path ?? "-").padEnd(28);
  const suffix = check.isDefault ? "default" : "";
  return `  ${status} ${template} ${executable} ${path} ${suffix}`.trimEnd();
}
```

- [ ] **Step 6: Dispatch command**

In `packages/cli/src/run.ts`, import `doctor` and `renderDoctor`. Add switch case:

```ts
case "doctor":
  return runDoctor(command, env);
```

Add:

```ts
async function runDoctor(
  command: Extract<CliCommand, { type: "doctor" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await doctor({}, { cwd }, deps);
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value);
    else emit(io, renderDoctor(value));
  });
}
```

- [ ] **Step 7: Run CLI tests**

Run:

```sh
bun test packages/cli/test/parse.test.ts packages/cli/test/run.test.ts
```

Expected: pass after implementation.

- [ ] **Step 8: Commit CLI projection**

```sh
but status -fv
but commit mik-045-doctor-command -m "Add doctor CLI command"
```

## Task 4: Add real executable resolver and final validation

**Files:**
- Modify: `packages/cli/src/runtime/adapters.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/runtime-adapters.test.ts` only when TypeScript coverage needs a direct adapter assertion; otherwise leave unchanged.

- [ ] **Step 1: Add real adapter**

In `packages/cli/src/runtime/adapters.ts`, import `ExecutableResolver` and add:

```ts
export const bunExecutableResolver: ExecutableResolver = {
  which: (name) => Promise.resolve(Bun.which(name)),
};
```

- [ ] **Step 2: Inject adapter**

In `packages/cli/src/main.ts`, import `bunExecutableResolver` and add to `createRuntimeDeps()`:

```ts
executableResolver: bunExecutableResolver,
```

- [ ] **Step 3: Run targeted tests**

Run:

```sh
bun test packages/ops/test/doctor.test.ts packages/cli/test/parse.test.ts packages/cli/test/run.test.ts packages/cli/test/runtime-adapters.test.ts
```

Expected: pass.

- [ ] **Step 4: Dogfood doctor**

Run:

```sh
bun run asem doctor
bun run asem doctor --json
```

Expected: both exit 0 and show availability checks. Missing binaries are acceptable.

- [ ] **Step 5: Full validation**

Run:

```sh
bun run typecheck && bun run test && bun run check
```

Expected: pass.

- [ ] **Step 6: Commit real adapter and validation fixes**

```sh
but status -fv
but commit mik-045-doctor-command -m "Wire doctor executable resolver"
```

## Task 5: Issue, review, PR, and merge

**Files:**
- mikan issue only, if board tracks this implementation.

- [ ] **Step 1: Create or update mikan issue**

Create `MIK-045` titled `Add doctor command for tool availability` with links to spec and plan.

- [ ] **Step 2: Request code review**

Ask reviewer to inspect `origin/main..HEAD` for:

- read-only doctor semantics
- exit code 0 for missing tools/config diagnostics
- injected executable resolver and fake tests
- no Session/store mutation or workflow scope creep

- [ ] **Step 3: Fix review findings**

Critical and Important findings must be fixed before PR merge. Minor findings may be fixed or documented.

- [ ] **Step 4: Push and open PR**

```sh
but push mik-045-doctor-command
gh pr create --base main --head mik-045-doctor-command --title "Add doctor command" --body-file /tmp/pr-mik045-doctor-command.md
```

- [ ] **Step 5: Merge and clean workspace**

After PR merge:

```sh
but pull --check
but pull
but status -fv
git status --short
```

If squash-merged files appear as stale modified files, verify hashes against `origin/main`, then unapply the merged branch.
