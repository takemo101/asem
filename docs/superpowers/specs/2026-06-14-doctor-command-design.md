# Doctor Command Design

## Status

Approved for implementation.

## Goal

Add `asem doctor` as a read-only CLI command that reports whether the builtin Agent and Multiplexer command-line tools supported by asem are installed on the local machine.

## Non-goals

- Do not create, close, attach, or mutate Sessions.
- Do not run real Agent or Multiplexer workflows.
- Do not inspect Session liveness, current Session tokens, store health, or message delivery.
- Do not introduce task/workflow/team/result semantics.
- Do not make missing tools a command failure.

## User-facing behavior

`asem doctor` prints a human-readable diagnostic report.

The first version checks builtin template command availability only:

- Multiplexer Templates:
  - `herdr` requires `herdr`
  - `tmux` requires `tmux`
  - `rmux` requires `rmux`
  - `zellij` requires `zellij`
- Agent Templates:
  - `claude` requires `claude`
  - `codex` requires `codex`
  - `pi` requires `pi`
  - `gemini` requires `gemini`
  - `agy` requires `agy`
  - `opencode` requires `opencode`

For each supported builtin template, output includes:

- kind: `agent` or `mux`
- template id
- required executable name
- status: `ok` or `missing`
- resolved path when found
- whether the template is the configured default, when a config was found

If `.asem.yaml` is discoverable and valid, the report includes:

- config path
- Workspace id
- default Agent Template
- default Multiplexer Template

If `.asem.yaml` is absent or invalid, `asem doctor` still reports builtin command availability and includes a diagnostic note for the config state. Missing or invalid config does not prevent binary checks.

`asem doctor --json` prints the same information as structured JSON.

Exit code policy:

- Missing tools still exit `0`.
- Missing config still exits `0`.
- Invalid config still exits `0` for doctor, with the config issue represented in the output.
- Parse errors for the doctor command itself, such as unknown flags, keep the existing CLI usage-error behavior.

## Example text output

```txt
asem doctor

Config: .asem.yaml
Workspace: asem
Default agent: claude
Default mux: herdr

Multiplexers:
  ok       herdr    herdr     /opt/homebrew/bin/herdr   default
  ok       rmux     rmux      /Users/example/.local/bin/rmux
  missing  tmux     tmux      -
  missing  zellij   zellij    -

Agents:
  ok       claude   claude    /opt/homebrew/bin/claude  default
  ok       pi       pi        /Users/example/.bun/bin/pi
  missing  codex    codex     -
  missing  gemini   gemini    -
  missing  agy      agy       -
  missing  opencode opencode  -
```

If config is missing:

```txt
Config: not found
Workspace: -
Default agent: -
Default mux: -
```

If config is invalid:

```txt
Config: invalid (/repo/.asem.yaml)
Issue: invalid_config: <message>
Workspace: -
Default agent: -
Default mux: -
```

## Architecture

### Core contracts

Add doctor input/output contracts to `@asem/core` operation types:

- `doctorInputSchema`
  - no fields in the first version
- `DoctorOutput`
  - config state summary
  - Agent check list
  - Multiplexer check list

Add a small `ExecutableResolver` port to `@asem/core` ports:

```ts
interface ExecutableResolver {
  which(name: string): Promise<string | null>;
}
```

Add `executableResolver` to `OpsDeps`.

### Ops behavior

Add `doctor()` in `@asem/ops`.

The operation:

1. Resolves the Worktree Root from `ctx.cwd`.
2. Attempts config discovery/loading.
3. Treats config discovery errors as diagnostic data, not operation failure.
4. Builds static checks for builtin Agent and Multiplexer Templates.
5. Uses `deps.executableResolver.which()` to resolve each required executable.
6. Marks configured defaults when valid config exists.
7. Returns `OperationResult<DoctorOutput>` with `ok: true` unless doctor itself receives invalid input.

The first version intentionally uses a static builtin command map instead of parsing command strings out of templates. This keeps the output stable and avoids overfitting shell snippets such as `ZELLIJ_SOCKET_DIR=... zellij ...` or `sh -c` attach commands.

### CLI projection

Add parser support for:

```sh
asem doctor
asem doctor --json
```

Add root help entry under Setup or Surfaces. Add focused help for `asem doctor --help`.

Add rendering functions:

- `renderDoctor(output: DoctorOutput): string[]`
- JSON path uses existing `emitJson`.

### Runtime adapter

The CLI composition root injects an `ExecutableResolver` backed by `Bun.which`.

Tests use fakes and never depend on the host having real Agent or Multiplexer binaries installed.

## Testing

Use TDD.

Required test coverage:

- CLI parser accepts `doctor` and `doctor --json`.
- CLI parser rejects unknown doctor flags.
- Help includes `doctor` and focused doctor help renders.
- Ops doctor returns all builtin Agent and Multiplexer checks.
- Found executables report `ok` with path.
- Missing executables report `missing` with null path.
- Valid config marks default Agent and Multiplexer.
- Missing config still returns ok with command checks.
- Invalid config still returns ok with command checks and an invalid-config note.
- CLI text rendering exits `0` with missing binaries.
- CLI JSON rendering exits `0` and includes structured check lists.

## Documentation

Update durable docs only where command maps or CLI examples need to mention doctor. This feature does not change domain language, storage, Session semantics, template semantics, Agent Profiles, or Multiplexer behavior.

## Risks and mitigations

- Risk: Host-dependent tests become flaky.
  - Mitigation: inject `ExecutableResolver` and fake it in tests.
- Risk: Doctor becomes a broad health system.
  - Mitigation: first version is limited to builtin command availability.
- Risk: Invalid config blocks useful binary checks.
  - Mitigation: config errors are represented as diagnostic output and do not fail the operation.
