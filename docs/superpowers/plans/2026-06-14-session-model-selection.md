# Session Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional model selection to Session creation, exposed through Agent Template `{{model_shell}}`, persisted as Session metadata, and surfaced by CLI/MCP/TUI projections.

**Architecture:** Keep Agent-specific command-line behavior in Agent Templates. `create_session` accepts optional `model`, validates whether the selected Agent Template supports it before side effects, passes it to runtime command rendering, and stores `Session.model`. Store migration adds a nullable `sessions.model` column. Surfaces only parse/render the shared model field; they do not validate model names or translate Agent-specific flags.

**Tech Stack:** TypeScript, Bun test, Zod schemas in `@asem/core`/`@asem/runtime`, SQLite migrations in `@asem/store`, shared ops/CLI/MCP/TUI projections, GitButler (`but`) for VCS.

---

## File map

- `packages/runtime/src/template/schema.ts`: add `model_flag` and `model_shell` placeholder validation.
- `packages/runtime/src/template/agent-command.ts`: render `{{model_shell}}` from optional model and `model_flag`.
- `packages/runtime/src/template/builtin.ts`: add model support to claude/codex/pi/gemini/opencode; keep agy unsupported.
- `packages/runtime/test/builtin-agent.test.ts`: runtime rendering/schema/builtin coverage.
- `packages/core/src/types/session.ts`: add `model: string | null` to Session.
- `packages/core/src/types/operations.ts`: add `model?: string` to CreateSessionInput.
- `packages/store/src/migrations.ts`: add schema version 2 with nullable `sessions.model`.
- `packages/store/src/rows.ts`: map model column to Session and insert values.
- `packages/store/src/sqlite-store.ts`: update insert column/value count.
- `packages/store/test/*`: migration, row parse, and session persistence tests.
- `packages/ops/src/operations/create-session.ts`: validate model support before side effects, pass model to renderer, store model.
- `packages/ops/test/create-session.test.ts`: create-session behavior coverage.
- `packages/cli/src/parse.ts`, `packages/cli/src/run.ts`, `packages/cli/src/usage.ts`, `packages/cli/src/render.ts`: CLI parse/help/render pass-through.
- `packages/cli/test/*`: parse/run/help or snapshot coverage.
- `packages/mcp/src/tools.ts`, `packages/mcp/test/tools.test.ts`: MCP schema/tool pass-through.
- `packages/tui/src/types.ts`, `packages/tui/src/tabs.ts`, `packages/tui/src/view/right-pane.ts`, relevant tests: detail view displays model when present.
- `docs/designs/asem-session-manager-design.md`: update config/persistence/create-session design for model selection if needed.

---

### Task 1: Runtime Template model placeholder

**Files:**
- Modify: `packages/runtime/src/template/schema.ts`
- Modify: `packages/runtime/src/template/agent-command.ts`
- Modify: `packages/runtime/src/template/builtin.ts`
- Modify: `packages/runtime/test/builtin-agent.test.ts`

- [ ] **Step 1: Add failing runtime tests**

In `packages/runtime/test/builtin-agent.test.ts`, update the builtin command expectations:

```ts
expect(agentTemplate("claude").command).toBe(
  "claude {{model_shell}} {{prompt_shell}}",
);
expect(agentTemplate("codex").command).toBe(
  "codex {{model_shell}} {{prompt_shell}}",
);
expect(agentTemplate("pi").command).toBe(
  "pi {{model_shell}} {{prompt_shell}}",
);
expect(agentTemplate("gemini").command).toBe(
  "gemini {{model_shell}} {{prompt_shell}}",
);
expect(agentTemplate("agy").command).toBe("agy -i {{prompt_shell}}");
expect(agentTemplate("opencode").command).toBe("opencode {{model_shell}}");
expect(agentTemplate("opencode").paste_prompt).toBe(true);
```

Add explicit model support tests:

```ts
test("model-supported builtins declare model_flag", () => {
  for (const name of ["claude", "codex", "pi", "gemini", "opencode"]) {
    expect(agentTemplate(name).model_flag).toBe("--model");
  }
  expect(agentTemplate("agy").model_flag).toBeUndefined();
});

test("model_shell renders a flag/value when model is specified", () => {
  const template = agentTemplateSchema.parse({
    command: "agent {{model_shell}} {{prompt_shell}}",
    model_flag: "--model",
  });
  expect(
    renderAgentCommand(template, { promptPath: PROMPT_PATH, model: "sonnet" }),
  ).toBe(`agent --model sonnet "$(cat ${PROMPT_SHELL})"`);
});

test("model_shell renders empty when model is omitted", () => {
  const template = agentTemplateSchema.parse({
    command: "agent {{model_shell}} {{prompt_shell}}",
    model_flag: "--model",
  });
  expect(renderAgentCommand(template, { promptPath: PROMPT_PATH })).toBe(
    `agent  "$(cat ${PROMPT_SHELL})"`,
  );
});

test("model_shell shell-escapes model values", () => {
  const template = agentTemplateSchema.parse({
    command: "agent {{model_shell}}",
    model_flag: "--model",
  });
  expect(
    renderAgentCommand(template, {
      promptPath: PROMPT_PATH,
      model: "claude's model",
    }),
  ).toContain("--model 'claude'\\''s model'");
});

test("rejects model_shell without model_flag", () => {
  expect(
    agentTemplateSchema.safeParse({ command: "agent {{model_shell}}" }).success,
  ).toBe(false);
});

test("rejects model_flag without model_shell", () => {
  expect(
    agentTemplateSchema.safeParse({
      command: "agent {{prompt_shell}}",
      model_flag: "--model",
    }).success,
  ).toBe(false);
});

test("paste_prompt may coexist with model_shell", () => {
  expect(
    agentTemplateSchema.safeParse({
      command: "opencode {{model_shell}}",
      model_flag: "--model",
      paste_prompt: true,
    }).success,
  ).toBe(true);
});
```

Also update existing `renderAgentCommand(template, PROMPT_PATH)` calls to `renderAgentCommand(template, { promptPath: PROMPT_PATH })`.

- [ ] **Step 2: Run failing test**

```sh
bun test packages/runtime/test/builtin-agent.test.ts
```

Expected: fail because schema/renderer/builtins do not know `model_shell`.

- [ ] **Step 3: Implement runtime schema**

In `packages/runtime/src/template/schema.ts`:

- Add `model_shell` to the allowed placeholder set.
- Add `model_flag: nonEmptyString.optional()` to `agentTemplateSchema`.
- Keep prompt placeholders (`prompt_shell`, `prompt_path_shell`) separate from model placeholders.
- Validation rules:
  - unknown placeholders still fail;
  - `model_shell` requires `model_flag`;
  - `model_flag` requires at least one `model_shell` placeholder;
  - `paste_prompt` is mutually exclusive only with prompt placeholders, not model placeholders;
  - `before_paste` still requires `paste_prompt: true`.

- [ ] **Step 4: Implement runtime rendering**

In `packages/runtime/src/template/agent-command.ts`:

Change signature to an object parameter:

```ts
export interface RenderAgentCommandInput {
  promptPath: string;
  model?: string | null;
}

export function renderAgentCommand(
  template: AgentTemplate,
  input: RenderAgentCommandInput,
): string { ... }
```

Rendering rules:

- `prompt_shell`: `"$(cat <escaped prompt path>)"`
- `prompt_path_shell`: escaped prompt path
- `model_shell`: empty string when `input.model == null`; otherwise `${shellEscape(template.model_flag)} ${shellEscape(input.model)}`

Keep the unreachable default error for schema-defended unknown placeholders.

- [ ] **Step 5: Update builtin Agent Templates**

In `packages/runtime/src/template/builtin.ts`:

```ts
claude: { command: "claude {{model_shell}} {{prompt_shell}}", model_flag: "--model" }
codex: { command: "codex {{model_shell}} {{prompt_shell}}", model_flag: "--model" }
pi: { command: "pi {{model_shell}} {{prompt_shell}}", model_flag: "--model" }
gemini: { command: "gemini {{model_shell}} {{prompt_shell}}", model_flag: "--model" }
agy: { command: "agy -i {{prompt_shell}}" }
opencode: { command: "opencode {{model_shell}}", model_flag: "--model", paste_prompt: true, before_paste: [...] }
```

- [ ] **Step 6: Run runtime tests**

```sh
bun test packages/runtime/test/builtin-agent.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```sh
but commit mik-040-session-model-selection -m "Add Agent Template model placeholder"
```

---

### Task 2: Core/store Session.model persistence

**Files:**
- Modify: `packages/core/src/types/session.ts`
- Modify: `packages/core/src/types/operations.ts`
- Modify: `packages/store/src/migrations.ts`
- Modify: `packages/store/src/rows.ts`
- Modify: `packages/store/src/sqlite-store.ts`
- Modify tests under `packages/store/test/`

- [ ] **Step 1: Add failing schema/store tests**

Add or update store tests to assert:

```ts
expect(LATEST_SCHEMA_VERSION).toBe(2);
```

Add a migration test that seeds a version-1 DB manually, runs `migrate(db)`, and verifies `sessions.model` exists and existing rows read as `model: null`.

Add row parse test:

```ts
const session = parseSessionRow({ ...validSessionRow, model: "sonnet" });
expect(session.model).toBe("sonnet");
const legacy = parseSessionRow({ ...validSessionRow, model: null });
expect(legacy.model).toBeNull();
```

Add session persistence test:

```ts
const session = makeSession({ model: "sonnet" });
await store.insertSession(session);
expect((await store.getSessionById(scopeA, session.id))?.model).toBe("sonnet");
```

- [ ] **Step 2: Run failing store/core tests**

```sh
bun test packages/store/test/migrations.test.ts packages/store/test/row-parse.test.ts packages/store/test/sessions.test.ts
```

Expected: fail because `model` is not in schemas/migrations/mapping.

- [ ] **Step 3: Update core types**

In `packages/core/src/types/session.ts`, add:

```ts
model: nonEmptyString.nullable(),
```

near `agent` / `mux`.

In `packages/core/src/types/operations.ts`, add optional model to `createSessionInputSchema`:

```ts
model: nonEmptyString.optional(),
```

- [ ] **Step 4: Add migration version 2**

In `packages/store/src/migrations.ts`, append:

```ts
{
  version: 2,
  up: `alter table sessions add column model text;`,
}
```

Keep version 1 unchanged so existing DBs migrate forward.

- [ ] **Step 5: Update row mapping and inserts**

In `packages/store/src/rows.ts`:

- Add `model: unknown` to `SessionRow`.
- Add `model: row.model ?? null` to `candidate`.
- Add `session.model` to `sessionInsertValues` after `session.mux`.

In `packages/store/src/sqlite-store.ts`, update `INSERT_SESSION` column list and placeholders:

```sql
id, workspace_id, worktree_root, name, cwd, agent, mux, model,
parent_session_id, ...
```

and add one `?` placeholder.

- [ ] **Step 6: Update test helpers / compile fallout**

Update every `makeSession` helper or literal Session object to include `model: overrides.model ?? null`.

- [ ] **Step 7: Run store/core tests**

```sh
bun test packages/store/test/migrations.test.ts packages/store/test/row-parse.test.ts packages/store/test/sessions.test.ts
bun run typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

```sh
but commit mik-040-session-model-selection -m "Persist Session model metadata"
```

---

### Task 3: create_session behavior

**Files:**
- Modify: `packages/ops/src/operations/create-session.ts`
- Modify: `packages/ops/test/create-session.test.ts`

- [ ] **Step 1: Add failing ops tests**

Add tests in `packages/ops/test/create-session.test.ts`:

```ts
test("persists model and renders model_shell for supported Agent Templates", async () => {
  // use agent claude, model sonnet
  // assert output.session.model === "sonnet"
  // assert launch script or runner command includes "--model sonnet"
});

test("omitting model keeps Session.model null and omits the model flag", async () => {
  // use agent claude without model
  // assert output.session.model === null
  // assert launch script/command does not contain "--model"
});

test("model for unsupported Agent Template fails before side effects", async () => {
  // use agent agy, model sonnet
  // expect invalid_input
  // assert no Session row, no mux runner commands, no session dir/prompt side effects if existing fakes expose them
});
```

Use existing fake runner/fs patterns from the file rather than real shell/mux.

- [ ] **Step 2: Run failing ops test**

```sh
bun test packages/ops/test/create-session.test.ts
```

Expected: fail until create-session handles model.

- [ ] **Step 3: Implement create_session model support**

In `create-session.ts`:

- After resolving `agentTemplate`, before ID/token/sessionDir side effects, add:

```ts
if (input.model !== undefined && agentTemplate.model_flag === undefined) {
  return err(
    operationError("invalid_input", "agent template does not support --model", {
      agent,
      model: input.model,
    }),
  );
}
```

Because runtime schema enforces `model_flag` + `model_shell` pairing, checking `model_flag` is enough.

- In `baseVars` add `model: input.model ?? ""` only if useful for non-agent-template sequences; do not rely on it for Agent command rendering.
- Change launch script env to include:

```ts
AS_MODEL: input.model ?? "",
```

- Change `renderAgentCommand(agentTemplate, promptPath)` to:

```ts
renderAgentCommand(agentTemplate, {
  promptPath,
  model: input.model ?? null,
})
```

- Add `model: input.model ?? null` to the Session object.

- [ ] **Step 4: Run ops test**

```sh
bun test packages/ops/test/create-session.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
but commit mik-040-session-model-selection -m "Apply model selection during Session create"
```

---

### Task 4: CLI/MCP projections

**Files:**
- Modify: `packages/cli/src/parse.ts`
- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/src/usage.ts`
- Modify: `packages/cli/src/render.ts`
- Modify: `packages/cli/test/parse.test.ts`
- Modify: `packages/cli/test/run.test.ts`
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/mcp/test/tools.test.ts`

- [ ] **Step 1: Add failing CLI/MCP tests**

CLI parse test:

```ts
expect(commandFor(["session", "create", "worker", "--prompt", "hi", "--model", "sonnet"])).toMatchObject({
  type: "session-create",
  model: "sonnet",
});
```

CLI run test should assert model reaches createSession and JSON/human render includes model where appropriate.

MCP tools test should assert `create_session` input schema contains `model` and handler passes it to ops.

- [ ] **Step 2: Run failing projection tests**

```sh
bun test packages/cli/test/parse.test.ts packages/cli/test/run.test.ts packages/mcp/test/tools.test.ts
```

Expected: fail until projections are updated.

- [ ] **Step 3: Implement CLI parse/run/help/render**

In `CliCommand` session-create variant add `model?: string`.

In `parseSessionCreate`:

- Add `model` to `values` spec.
- Read `const model = values.get("model")`.
- Include `...(model !== undefined ? { model } : {})` in command.

In `runSessionCreate`, pass `model` into `createSession` input.

In `usage.ts`, add `--model <model>` to focused `session create` help with Template-dependent wording:

```text
--model <model>    model value passed through Agent Template {{model_shell}}
                   (fails if the Agent Template does not support models)
```

In `render.ts`:

- `sessionRow`: render `agent=... model=... mux=...` or append `model=<value>` when non-null.
- `renderSessionDetail`: add `model:         ${session.model ?? "-"}`.
- `renderCreatedSession`: add model line only when non-null or always as `model:  -`; prefer non-null only for compactness.

- [ ] **Step 4: Implement MCP schema**

In `packages/mcp/src/tools.ts`, add `model: stringSchema` to `toolDefinitions.create_session.inputSchema.properties`. Shared `createSessionInputSchema` already parses it.

- [ ] **Step 5: Run projection tests**

```sh
bun test packages/cli/test/parse.test.ts packages/cli/test/run.test.ts packages/mcp/test/tools.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```sh
but commit mik-040-session-model-selection -m "Expose Session model selection in CLI and MCP"
```

---

### Task 5: TUI/detail projections and docs

**Files:**
- Modify: `packages/tui/src/types.ts`
- Modify: `packages/tui/src/tabs.ts`
- Modify: `packages/tui/src/view/right-pane.ts`
- Modify TUI tests: likely `packages/tui/test/view.test.ts` or `packages/tui/test/view-model.test.ts`
- Modify docs: `docs/designs/asem-session-manager-design.md`

- [ ] **Step 1: Add failing TUI detail test**

Add/modify a test so a selected Session with `model: "sonnet"` projects detail including model.

Expected right pane line:

```text
model:         sonnet
```

For null model, expected:

```text
model:         -
```

- [ ] **Step 2: Implement TUI projection**

In `DetailView`, add:

```ts
model: string | null;
```

In `tabs.ts` `detailView`, map `model: session.model`.

In `right-pane.ts`, render after agent:

```ts
`model:         ${detail.model ?? "-"}`,
```

- [ ] **Step 3: Update docs**

In `docs/designs/asem-session-manager-design.md`:

- Add `model text` nullable to sessions table doc.
- Add create-session model behavior under Agent Template/config or create flow:
  - optional model is persisted as Session metadata;
  - Agent Template `model_flag` + `{{model_shell}}` own CLI flag rendering;
  - unsupported Template + model returns `invalid_input` before side effects;
  - `agy` builtin is model-unsupported.

- [ ] **Step 4: Run TUI/docs tests**

```sh
bun test packages/tui/test/view.test.ts packages/tui/test/view-model.test.ts
bun test packages/cli/test/docs-links.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
but commit mik-040-session-model-selection -m "Show Session model metadata"
```

---

### Task 6: Full validation, review, and PR

**Files:** all changed files.

- [ ] **Step 1: Run targeted tests**

```sh
bun test packages/runtime/test/builtin-agent.test.ts \
  packages/store/test/migrations.test.ts packages/store/test/row-parse.test.ts packages/store/test/sessions.test.ts \
  packages/ops/test/create-session.test.ts \
  packages/cli/test/parse.test.ts packages/cli/test/run.test.ts \
  packages/mcp/test/tools.test.ts \
  packages/tui/test/view.test.ts packages/tui/test/view-model.test.ts
```

Expected: pass.

- [ ] **Step 2: Run diagnostics**

Run LSP diagnostics on changed TS files. Expected: 0 diagnostics.

- [ ] **Step 3: Run full validation**

```sh
bun run typecheck
bun run test
bun run check
```

Expected: typecheck/test/check pass. Existing Biome warnings may remain; no new errors.

- [ ] **Step 4: Parent review**

Report to parent with:

```sh
bun run asem -- report parent --summary "MIK-040 complete: ..."
```

Report must include:

- changed files;
- commits;
- validation commands/results;
- residual risks;
- any behavior deviations from `docs/superpowers/specs/2026-06-14-session-model-selection-design.md`.

The parent/orchestrator will review, request fixes if needed, and create/merge the PR.
