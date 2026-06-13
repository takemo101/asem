# asem Init Wizard Design

## Status

Draft, created on 2026-06-08.

Related documents:

- [`../../CONTEXT.md`](../../CONTEXT.md) — domain language, including `Init Wizard`, `Agent`, `Multiplexer`, and `Template`.
- [`asem-session-manager-design.md`](./asem-session-manager-design.md) — MVP Session manager design and existing `asem init` configuration rules.
- [`../architecture/overview.md`](../architecture/overview.md) — package boundaries and CLI/ops/runtime dependency direction.

## Context

`asem init` currently initializes a worktree with a small `.asem.yaml` and runtime ignore rules. The generated config uses fixed defaults and omits empty project-local Template maps:

```yaml
workspace:
  id: my-workspace

mux:
  default: herdr

agent:
  default: claude
```

That is enough for non-interactive setup, but it makes first-time human setup feel incomplete: the operator must know the available Agent and Multiplexer names, then edit `.asem.yaml` by hand if they want project-local command templates.

The Init Wizard improves first-time setup without changing asem's domain model. It is a human CLI setup flow for initial configuration only; it is not a general configuration editor, environment doctor, template marketplace, or template authoring workflow.

## Goals

- Add an explicit interactive setup path via `asem init --interactive`.
- Let a human choose the default Agent Template and default Multiplexer Template from builtin Templates.
- Let a human choose one or more builtin Agent Templates and one or more builtin Multiplexer Templates to materialize into `.asem.yaml` using the existing template schemas.
- Keep non-interactive `asem init --workspace <id>` working.
- Allow non-interactive template selection via `--agent <name>` and `--mux <name>`.
- Keep interactive prompting confined to the CLI surface.
- Preserve the existing idempotent rule: an existing `.asem.yaml` is not overwritten.

## Non-goals

The Init Wizard must not add:

- editing of arbitrary command strings during setup;
- executable discovery or `command -v` checks;
- validation that the selected external Agent or Multiplexer binary is installed;
- rewriting or merging an existing `.asem.yaml`;
- a general `asem config edit` flow;
- template includes/imports;
- template marketplace behavior;
- task/workflow/team orchestration concepts.

## CLI behavior

### Commands

Existing non-interactive init remains valid:

```sh
asem init --workspace my-workspace
```

Interactive init is opt-in:

```sh
asem init --interactive
```

`--agent` and `--mux` are accepted by `asem init` in both modes:

```sh
asem init --workspace my-workspace --agent pi --mux tmux
asem init --interactive --workspace my-workspace --agent pi
```

Rules:

- `--interactive` starts the Init Wizard.
- Without `--interactive`, init stays non-interactive.
- In interactive mode, provided flags are treated as already answered and skipped.
- If `--workspace` is omitted in interactive mode, the wizard proposes the worktree root directory name as the default workspace id.
- Interactive mode asks the operator to choose one or more builtin Agent Templates and one or more builtin Multiplexer Templates to materialize.
- Interactive mode then asks for the default Agent Template / Multiplexer Template from the selected Template sets, unless a set contains only one Template or the default was preselected by flag.
- If `--agent` or `--mux` is provided in interactive mode, that value is treated as the fixed default Template for its category. It is shown checked and locked in the corresponding Template checkbox prompt as `<name> (default)`, and additional Templates can still be selected.
- If `--agent` or `--mux` is omitted in interactive mode, the checkbox initially selects the existing default (`claude` for Agent Templates, `herdr` for Multiplexer Templates). If that default remains selected, the default select initially highlights it; otherwise it highlights the selected Template with the first builtin name in ascending order.
- Agent Template and Multiplexer Template checkbox prompts require at least one selected Template.
- If only one Template is selected in a category, that Template becomes the default and the default select prompt is skipped.
- `--agent` and `--mux` must name known builtin Templates when init needs to materialize them.
- `--interactive` requires a TTY. In a non-TTY environment, the CLI returns a structured error with guidance to use non-interactive flags.

### Existing config

If `.asem.yaml` already exists at the resolved worktree root:

- init does not overwrite it;
- the runtime `.gitignore` rules are still ensured;
- interactive mode reports that existing config was left untouched;
- no merge or update flow runs.

This preserves the current idempotent behavior and avoids destroying hand-written project-local Templates.

### Final confirmation

Before writing a new `.asem.yaml`, the Init Wizard shows a summary:

```text
Workspace: my-workspace
Default Agent Template: pi
Agent Templates: claude, pi
Default Multiplexer Template: tmux
Multiplexer Templates: herdr, tmux
Config: /path/to/worktree/.asem.yaml
```

The operator confirms with yes/no.

If the operator answers no, presses Ctrl+C, or the prompt is otherwise cancelled:

- no files are written;
- stdout/stderr reports `cancelled; no files changed`;
- the process exits with code `0`.

## Generated configuration

When Agent Templates `claude` and `pi` and Multiplexer Templates `herdr` and `tmux` are selected, with `pi` and `tmux` as defaults, the generated config has this shape. The command values below are examples from the current builtin Templates; implementation should render whatever the runtime builtins contain at the time. Materialized Template maps are emitted in builtin-name ascending order, not prompt selection order.

```yaml
workspace:
  id: my-workspace

mux:
  default: tmux
  templates:
    tmux:
      create:
        - type: run
          command: "tmux new-window -P -F '#{session_name}|#{window_id}|#{pane_id}' -c {{cwd_shell}} -n {{name_shell}}"
          capture:
            - name: session_name
              regex: '^([^|]*)\\|'
              group: 1
            - name: window_id
              regex: '^[^|]*\\|([^|]*)\\|'
              group: 1
            - name: pane_id
              regex: '\\|([^|\\s]+)\\s*$'
              group: 1
      run_in_pane:
        - type: run
          command: "tmux send-keys -t {{pane_id_shell}} {{launch_cmd_shell}} Enter"
      send:
        - type: run
          command: "tmux send-keys -t {{pane_id_shell}} {{message_shell}} Enter"
      attach:
        - type: run
          command: "tmux select-window -t {{window_id_shell}}"
        - type: run
          command: "tmux select-pane -t {{pane_id_shell}}"
        - type: run
          command: "tmux attach-session -t {{session_name_shell}}"
      close:
        - type: run
          command: "tmux kill-pane -t {{pane_id_shell}}"

agent:
  default: pi
  templates:
    claude:
      command: "claude {{prompt_shell}}"
    pi:
      command: "pi {{prompt_shell}}"
```

The command strings come from `@asem/runtime` builtin Templates. The wizard does not invent separate command definitions.

Materialization rules:

- Use `builtinAgentTemplates` and `builtinMuxTemplates` from `@asem/runtime` as the source of truth.
- Materialize every selected Agent Template and every selected Multiplexer Template.
- Always include the default Agent Template and default Multiplexer Template in the materialized maps.
- Dedupe selected Template names before materialization.
- Emit materialized Agent and Multiplexer Templates in builtin-name ascending order for deterministic output.
- Materialized Agent Templates use the current Agent Template schema; prompt-aware commands may include placeholders such as `{{prompt_shell}}` and `{{prompt_path_shell}}`.
- Parse the selected Agent Template with `agentTemplateSchema` before writing.
- Parse the selected Multiplexer Template with `muxTemplateSchema` before writing.
- Write the parsed values using the existing `.asem.yaml` config shape.
- Keep `agent.default` and `mux.default` equal to the selected default Template names.
- Keep project-local template names equal to the selected builtin Template names.
- Generate block-style YAML and avoid flow-style empty collection notation such as `: {}` or `: []`. Omit schema-default empty fields from generated config: empty top-level `templates` maps, empty Mux Template command sequences, empty `attach_command`, and empty `refs` maps. Existing hand-written config may still spell those values explicitly; parsing remains representation-neutral.

The renderer should be deterministic so tests can assert exact output. A small YAML renderer for the known config/template shapes is acceptable; no new YAML stringification dependency is required.

## Package boundaries

### `@asem/cli`

Owns the Init Wizard surface:

- CLI flag parsing for `--interactive`, `--agent`, and `--mux` on `init`;
- TTY checks;
- prompt adapter using `@inquirer/prompts`;
- wizard flow and summary confirmation;
- rendering cancellation and non-TTY guidance;
- dependency on `@inquirer/prompts`.

Inquirer must be wrapped behind a small prompt port, for example:

```ts
interface InitWizardPrompts {
  input(request: InputPrompt): Promise<string>;
  select<T extends string>(request: SelectPrompt<T>): Promise<T>;
  confirm(request: ConfirmPrompt): Promise<boolean>;
}
```

The concrete adapter imports `input`, `select`, and `confirm` from `@inquirer/prompts`. Wizard tests use a fake prompt port.

### `@asem/ops`

Remains non-interactive. It continues to own the init operation's filesystem semantics:

- resolve the worktree root;
- write `.asem.yaml` when missing;
- ensure runtime `.gitignore` rules;
- avoid overwriting existing config.

The init operation input may grow to include selected Agent Template / Multiplexer Template materialization data, but it must not import or call Inquirer.

### `@asem/runtime`

Continues to own builtin Template definitions and template schemas. The wizard uses runtime exports as data; it does not duplicate builtin command strings.

### `@asem/core`

Continues to own config schemas and operation contracts. If init inputs are extended for selected Agent Template / Multiplexer Template materialization, their schemas live here.

## Error handling

- Unknown `--agent` or `--mux`: `invalid_input` with a message listing known builtin names.
- Invalid selected builtin Template: structured template/config error before any file write.
- Non-TTY `--interactive`: structured error explaining that interactive init requires a TTY and showing the non-interactive equivalent flags.
- Existing `.asem.yaml`: not an error; leave config untouched and still ensure `.gitignore` runtime rules.
- Prompt cancellation: success exit code `0`, no file writes.

## Testing

Default tests must not require real terminals, real multiplexers, real Agent CLIs, or real Inquirer prompts.

Add or update tests:

- `packages/cli/test/parse.test.ts`
  - parses `asem init --interactive`;
  - parses `asem init --workspace ws --agent pi --mux tmux`;
  - rejects malformed/unknown init flags.
- `packages/cli/test/init-wizard.test.ts`
  - fake prompt port supports checkbox prompts with checked and disabled choices;
  - workspace default is derived from the worktree root basename;
  - Agent Template and Multiplexer Template checkbox prompts require at least one selected Template;
  - no-flag interactive init starts with `claude` and `herdr` checked;
  - preselected `--agent` / `--mux` values are fixed defaults, shown checked+locked as `<name> (default)`, while still allowing additional Templates;
  - a single selected Template skips the corresponding default select;
  - multiple selected Templates prompt for the default from the selected set;
  - final confirm `false` writes no files and exits successfully;
  - prompt cancellation writes no files and exits successfully.
- `packages/cli/test/run.test.ts`
  - non-interactive init keeps current single Agent Template / single Multiplexer Template materialization behavior;
  - interactive init materializes every selected Template and writes deterministic YAML without duplicates;
  - existing-config interactive init does not prompt or rewrite `.asem.yaml`;
  - `--interactive` in non-TTY mode returns guidance rather than hanging.
- Existing smoke tests
  - `init → init-session → create-session → list/get → send-message → report-parent → message-list → close → delete` still passes.

## Documentation updates

When implemented, update:

- CLI usage text for `asem init` flags;
- `docs/designs/asem-session-manager-design.md` config/init sections if they still describe fixed `herdr`/`claude` defaults as the only init output;
- any README or examples that show first-time setup.

## ADR decision

No ADR is needed for this feature. The decision is useful but not hard to reverse: the wizard is an opt-in CLI surface, the `@inquirer/prompts` dependency is localized to `@asem/cli`, and the generated config uses the existing Template schema.
