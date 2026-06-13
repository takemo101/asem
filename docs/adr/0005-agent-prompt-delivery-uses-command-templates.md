# ADR 0005: Agent prompt delivery uses command templates

## Status

Accepted, 2026-06-13.

## Context

Agent Templates originally described prompt delivery with two fields:

```yaml
command: "agent"
prompt_delivery: arg | stdin | file | paste
```

This kept the first MVP small, but it made common agent CLI shapes awkward:

```sh
agent --prompt <prompt>
agent --prompt-file <prompt.md>
agent --prompt <prompt> --continue
```

The enum-based model forced `arg` and `file` delivery to append the prompt value
or prompt file path to the end of `command`. Users could sometimes bake a flag
into `command`, but prompt placement before trailing fixed arguments was not
represented cleanly.

Agent Template prompt semantics must remain separate from Multiplexer Template
semantics. Mux Templates own pane/session lifecycle and text injection; Agent
Templates own how the external Agent CLI is invoked and how the initial prompt is
made available to it.

## Decision

Replace `prompt_delivery` with Agent command templates.

Agent Template `command` remains a shell command string, but it may include a
small, prompt-specific placeholder set:

```yaml
command: "agent --prompt {{prompt_shell}} --continue"
```

Allowed prompt placeholders:

- `{{prompt_shell}}` — a shell-safe snippet that reads `prompt.md`, e.g.
  `"$(cat /path/to/prompt.md)"`; it does not embed the prompt body directly in
  `launch.sh`.
- `{{prompt_path_shell}}` — the shell-escaped path to `prompt.md`.

Unknown placeholders are invalid Agent Template configuration.

Prompt paste remains a separate explicit boolean:

```yaml
command: "opencode"
paste_prompt: true
before_paste:
  - type: wait_ms
    ms: 750
```

Rules:

- `prompt_delivery` is removed rather than kept as a compatibility alias.
- `paste_prompt: true` is mutually exclusive with prompt placeholders in
  `command`.
- `before_paste` is allowed only when `paste_prompt: true`.
- `before_paste` replaces the old `after_start` name; it is a Command Sequence
  that runs after the Agent starts and before the prompt is pasted through the
  mux `send` sequence.
- A `command` with no prompt placeholder and no `paste_prompt` is allowed. In
  that case the prompt is still written to `prompt.md`, but asem does not pass it
  to the Agent unless the command/wrapper reads it itself.

Builtin Agent Templates migrate as follows:

- `claude`: `claude {{prompt_shell}}`
- `codex`: `codex {{prompt_shell}}`
- `pi`: `pi {{prompt_shell}}`
- `gemini`: `gemini {{prompt_shell}}`
- `agy`: `agy -i {{prompt_shell}}`
- `opencode`: `opencode` with `paste_prompt: true` and `before_paste` wait.

## Consequences

- Agent Template prompt placement becomes explicit and supports flags, file
  paths, stdin redirection, and trailing fixed arguments using the same `command`
  string.
- Existing `.asem.yaml` files using `prompt_delivery` must be migrated.
- Schema and docs become simpler in the long run because there is one primary
  prompt-delivery mechanism instead of an enum plus special append behavior.
- The launch script continues to avoid embedding prompt text directly; the prompt
  body remains in `prompt.md`.
- Users can intentionally write templates that do not pass the prompt to the
  Agent; this is flexible but means asem cannot detect every prompt-delivery
  mistake.

## Rejected alternatives

### Keep `prompt_delivery` as a legacy compatibility field

This would avoid breaking existing configs, but it leaves two prompt delivery
models in the schema and requires conflict rules for templates that specify both
`prompt_delivery` and command placeholders.

### Add more enum variants

Adding modes such as `prompt_flag`, `prompt_file_flag`, or `arg_before_trailing`
would solve individual cases but would keep growing the enum every time another
CLI shape appears.

### Use structured argv instead of shell command strings

An argv model is safer for escaping, but the runtime and templates are already
shell-command oriented. Shell features such as stdin redirection are useful for
Agent CLI integration, so argv would require a larger redesign.

### Let Mux Templates own prompt delivery

Rejected because Multiplexer Templates should stay focused on pane/session
lifecycle and text injection. Prompt meaning belongs to Agent Templates.
