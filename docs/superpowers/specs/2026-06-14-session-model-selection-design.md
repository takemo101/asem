# Session Model Selection Design

## Context

`asem session create` currently selects an Agent Template and Multiplexer Template, but it cannot pass a per-Session model choice to the launched Agent. The only current workaround is to create separate Agent Templates such as `claude-sonnet` and `claude-opus`.

Agent CLIs differ in how they spell model selection and some Agents do not support model selection at all. The design should therefore keep Agent-specific command-line details in Agent Templates, not in `@asem/ops` or surface code.

Related durable docs:

- `CONTEXT.md` — Session, Agent, Template, Command Sequence language.
- `docs/designs/asem-session-manager-design.md` — Session creation and persistence model.
- `docs/adr/0005-agent-prompt-delivery-uses-command-templates.md` — Agent Templates own external Agent CLI invocation and prompt placeholders.

## Goals

- Let humans and agents choose a model when creating a Session.
- Preserve Agent Template ownership of external Agent CLI invocation.
- Persist the chosen model as Session metadata so `list`, `get`, JSON, MCP, and TUI projections can show how a Session was launched.
- Avoid silent no-op behavior when a model is specified for an Agent Template that cannot use it.
- Keep model support optional per Template; Agents such as `agy` may remain model-unsupported.

## Non-goals

- No Agent-specific model validation.
- No model alias map.
- No provider selection.
- No model discovery/listing.
- No Init Wizard model picker.
- No interpretation of whether a selected model made the Agent more or less capable.
- No task/workflow/team concepts.

## CLI and operation contract

Add optional `model` to `create_session`:

```ts
create_session({
  name: "reviewer",
  prompt: "Review this branch",
  agent: "claude",
  model: "sonnet",
});
```

CLI projection:

```sh
asem session create reviewer --agent claude --model sonnet --prompt 'Review this branch'
```

Rules:

- `--model` is optional.
- Omitting `--model` preserves current behavior.
- `--model` requires a non-empty string.
- `--model` is launch configuration for the new Session; it does not affect the parent Session.
- `--model` is accepted by CLI and MCP create-session surfaces through the shared `CreateSessionInput` schema.

## Session persistence

Add nullable model metadata to the Session record:

```ts
interface Session {
  // existing fields...
  agent: string;
  mux: string;
  model: string | null;
}
```

Storage:

- Add a nullable `model` column to `sessions`.
- Existing rows migrate with `model = null`.
- New Session rows store the parsed `input.model ?? null`.
- Raw Session tokens remain unaffected; model is not secret.

Projection:

- `session get --json` includes `model`.
- MCP `get_session` / `list_sessions` include `model` through the shared Session shape.
- Human `session get` and `session list` render the model when non-null.
- TUI may show the model as secondary Session metadata near Agent/Multiplexer without changing Cockpit semantics.

## Agent Template model support

Extend Agent Template schema with optional `model_flag`:

```yaml
agent:
  templates:
    claude:
      command: "claude {{model_shell}} {{prompt_shell}}"
      model_flag: "--model"
```

Add one model placeholder:

- `{{model_shell}}`

`{{model_shell}}` is an optional shell fragment, not just the raw model value:

- If `model` is specified and `model_flag` is `--model`, it expands to:

  ```sh
  --model <shell-escaped-model>
  ```

- If `model` is omitted, it expands to the empty string.

This keeps model omission convenient:

```yaml
command: "claude {{model_shell}} {{prompt_shell}}"
```

renders as:

```sh
claude --model sonnet "$(cat /path/to/prompt.md)"
```

when `model = "sonnet"`, and:

```sh
claude "$(cat /path/to/prompt.md)"
```

when no model is specified.

### Template validity rules

- A Template may omit both `model_flag` and `{{model_shell}}`; it is model-unsupported.
- `model_flag` and `{{model_shell}}` must appear together. A Template with only one of them is `invalid_template`.
- `model_flag` is one shell-token flag such as `--model` or `-m`. Rendering shell-escapes both the flag and the model value.
- Unknown placeholders remain invalid Agent Template configuration.
- `paste_prompt: true` remains mutually exclusive only with prompt placeholders, not with `{{model_shell}}`. A paste-prompt Agent may still support model selection in its startup command.

### Create-time support rule

When `create_session` receives `model`:

1. Resolve the Agent Template before filesystem, mux, or store side effects.
2. Check whether the resolved Template supports model selection.
3. If unsupported, return structured error:

```text
invalid_input: agent template does not support --model
```

with details such as `{ agent, model }`, but no command execution.

This prevents silent no-op behavior like saving `model: "sonnet"` while launching an Agent command that cannot receive that model.

## Builtin Templates

Builtin Agent Templates should reflect known support conservatively.

Model-supported builtins:

```yaml
claude:
  command: "claude {{model_shell}} {{prompt_shell}}"
  model_flag: "--model"

codex:
  command: "codex {{model_shell}} {{prompt_shell}}"
  model_flag: "--model"

pi:
  command: "pi {{model_shell}} {{prompt_shell}}"
  model_flag: "--model"

gemini:
  command: "gemini {{model_shell}} {{prompt_shell}}"
  model_flag: "--model"

opencode:
  command: "opencode {{model_shell}}"
  model_flag: "--model"
  paste_prompt: true
  before_paste:
    - type: wait_ms
      ms: 750
```

Model-unsupported builtin:

```yaml
agy:
  command: "agy -i {{prompt_shell}}"
```

`agy` intentionally remains model-unsupported. If a user runs:

```sh
asem session create child --agent agy --model sonnet --prompt '...'
```

asem returns `invalid_input` before side effects.

## Rendering and UX

Help text:

```text
asem session create <name> --prompt <text> [--model <model>] [options]
```

Focused help should describe model support as Template-dependent:

```text
--model <model>    model value passed through Agent Template {{model_shell}}
                   (fails if the selected Agent Template does not support models)
```

Human render examples:

```text
s_123 reviewer  running  agent=claude model=sonnet mux=herdr
```

If `model` is null, omit the model field from compact human list output to avoid noise.

## Error handling

- Invalid raw input schema: existing `invalid_input` path.
- Empty model string: `invalid_input` from the shared schema.
- Model specified for unsupported Template: `invalid_input` before Session dir, prompt file, mux create, launch script, or store insert.
- Malformed Agent Template model placeholder / missing `model_flag`: `invalid_template` during template resolution, like other Template schema defects.
- Agent CLI rejects the model at runtime: create fails in the existing mux launch path with the redacted sequence error/log path behavior. asem does not validate model names in advance.

## Package impact

### `@asem/core`

- Add `model?: string` to `CreateSessionInput` schema.
- Add `model: string | null` to `Session` schema/type.

### `@asem/runtime`

- Extend `agentTemplateSchema` with `model_flag?: string`.
- Extend allowed Agent command placeholders with `model_shell`.
- Change `renderAgentCommand` to accept `{ promptPath, model }` or equivalent parameters.
- Render `{{model_shell}}` using `model_flag` and shell escaping.
- Validate placeholder/model_flag consistency.

### `@asem/ops`

- Validate model support after Agent Template resolution and before side effects.
- Pass model to `renderAgentCommand`.
- Store `model: input.model ?? null` on the new Session.

### `@asem/store`

- Add migration for nullable `sessions.model`.
- Map DB rows to/from the new Session field.

### `@asem/cli`

- Parse `--model` on `session create`.
- Pass it through to `createSession`.
- Update focused help and renderers.

### `@asem/mcp`

- Add optional `model` to create-session JSON Schema.
- Shared zod parsing handles the actual input contract.

### `@asem/tui`

- Display model metadata where Session details are shown. No TUI create flow exists in this slice, so TUI does not need model input controls.

## Testing

Minimum coverage:

- Runtime rendering:
  - `{{model_shell}}` expands to `--model <escaped>` when model is specified.
  - `{{model_shell}}` expands to empty when model is omitted.
  - `{{model_shell}}` without `model_flag` is invalid.
  - `model_flag` without `{{model_shell}}` is invalid.
  - `paste_prompt: true` can coexist with `{{model_shell}}`.
- Builtin Templates:
  - claude/codex/pi/gemini/opencode parse with model support.
  - agy parses without model support.
- Create Session:
  - specified model is persisted on Session.
  - launch script includes the model shell fragment for model-supported Templates.
  - model omitted preserves existing launch command shape.
  - `agy` + model fails before filesystem/mux/store side effects.
- CLI parse/run/help:
  - `session create --model <model>` parses and passes through.
  - empty/missing model value is rejected.
  - help documents Template-dependent behavior.
- MCP tools:
  - create_session schema includes optional `model`.
- Store migration / mapping:
  - old rows map to `model: null`.
  - new rows persist model.
- TUI/view rendering:
  - model appears when non-null and is omitted/noisy nowhere when null.

## Rollout

This is a schema/storage change, so implement in a dedicated slice after this design is approved:

1. Runtime Template schema/render tests.
2. Core Session/CreateSession schema updates.
3. Store migration and row mapping tests.
4. Ops create-session behavior tests.
5. CLI/MCP/TUI projection tests.
6. Builtin Template updates.
7. Full validation.

No ADR is required unless implementation discovers a contradiction with ADR 0005. This design extends the accepted Agent command-template model rather than replacing it.
