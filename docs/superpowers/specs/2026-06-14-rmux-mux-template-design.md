# RMUX builtin Multiplexer Template design

## Context

asem launches and controls local agent Sessions through declarative Multiplexer Templates. Builtin templates currently cover `herdr`, `tmux`, and `zellij`. A new builtin `rmux` template should let users choose [RMUX](https://github.com/Helvesec/rmux), a Rust terminal multiplexer with tmux-compatible CLI commands.

RMUX README quickstart shows the commands asem needs:

```sh
rmux new-session -d -s work
rmux split-window -h -t work
rmux send-keys -t work 'echo "hello from rmux"' Enter
rmux attach-session -t work
```

RMUX source also exposes session/pane/window commands for `new-session`, `list-panes`, `send-keys`, `attach-session`, `kill-session`, `split-window`, and `kill-pane`.

## Goal

Add `rmux` as a builtin Multiplexer Template with the same Session-manager semantics as the tmux builtin:

- create a detached RMUX session scoped to the asem Session id;
- run the generated launch command in the RMUX pane;
- send Messages by injecting literal text plus Enter;
- provide a human attach command;
- close the RMUX session during `close_session` cleanup.

## Non-goals

- Do not add RMUX web-share support.
- Do not use RMUX SDK APIs in this slice.
- Do not add RMUX-specific workflow, orchestration, agent status, or outcome semantics.
- Do not change Session, Message, or Effective Scope behavior.
- Do not change existing `herdr`, `tmux`, or `zellij` templates except for shared tests that enumerate builtin mux ids.

## Template shape

Use a dedicated `rmux` builtin template rather than an alias to `tmux`. The first implementation should be conservative and rely only on documented or source-backed CLI commands.

### Refs

Declare the RMUX session name from the asem Session id:

```ts
refs: { rmux_session_name: "{{session_id}}" }
```

This matches the tmux/zellij pattern: the stable session name is derivable from base variables and does not need a fake capture step.

### Create

Create a detached RMUX session named by `session_id` and rooted at the requested cwd. Capture the initial pane id with a second `list-panes` command:

```sh
rmux new-session -d -s {{session_id_shell}} -c {{cwd_shell}}
rmux list-panes -t {{session_id_shell}} -F '#{pane_id}'
```

Why not `rmux new-session -P -F '#{pane_id}'`? RMUX has tmux-compatible command names, but `-P -F` support is not established by the README excerpt. `list-panes` has source-backed format support, so it is the safer first template. If real integration proves `new-session -P -F` works, the template can be simplified.

### run_in_pane

Inject the generated launch command literally, then press Enter:

```sh
rmux send-keys -t {{rmux_session_name_shell}} -l {{launch_cmd_shell}}
rmux send-keys -t {{rmux_session_name_shell}} Enter
```

This mirrors tmux and keeps token material out of command-line args because `launch_cmd` points at the generated launch script, not raw token content.

### send

Inject formatted Message text literally, wait briefly, then press Enter:

```sh
rmux send-keys -t {{rmux_session_name_shell}} -l {{message_shell}}
rmux send-keys -t {{rmux_session_name_shell}} Enter
```

Use the same small `wait_ms` pause as tmux between literal input and Enter.

### attach

Attach to the named RMUX session:

```sh
rmux attach-session -t {{rmux_session_name_shell}}
```

Expose structured `attach_command` as:

```ts
["rmux", "attach-session", "-t", "{{rmux_session_name}}"]
```

### close

Close the named RMUX session:

```sh
rmux kill-session -t {{rmux_session_name_shell}}
```

Do not infer work outcome from this. It is pane/session cleanup only.

## Tests

Default tests must use the fake TemplateRunner and must not require `rmux` to be installed.

Add coverage in `packages/runtime/test/builtin-mux.test.ts` for:

- builtin mux registry includes `rmux`;
- `create` runs `rmux new-session` and then `rmux list-panes`, captures `pane_id`, and preserves cwd/env propagation;
- declared refs include `rmux_session_name`;
- `run_in_pane` sends the launch command then Enter;
- `send` sends Message text literally then Enter;
- `attach` and `attach_command` target the RMUX session name;
- `close` kills the RMUX session.

Update other builtin-template tests that enumerate mux ids so they include `rmux`.

Optional real integration tests may be added only if they skip when `rmux` is unavailable.

## Docs and generated config

Update user-facing docs/help paths that list builtin mux templates so `rmux` appears beside `herdr`, `tmux`, and `zellij`.

If the init wizard materializes selected builtin mux templates, RMUX should be selectable by name once the builtin registry includes it. No config schema change is needed.

## Risks

- RMUX CLI compatibility may differ from tmux for some flags. The design avoids unconfirmed `new-session -P -F` and uses `list-panes` for capture.
- `send-keys -l` behavior should be validated by optional integration when RMUX is installed.
- If RMUX requires a different cwd flag than `-c`, fake tests will still pass while real use fails. Real integration or local `rmux new-session --help` should verify before relying on it broadly.

## Acceptance criteria

- `rmux` resolves through `createTemplateRegistry().getMuxTemplate("rmux")`.
- Fake-runner tests cover all five mux sequences and structured attach command.
- Existing builtin mux tests continue to pass.
- Docs/help mention RMUX where builtin multiplexers are listed.
- `bun test packages/runtime/test/builtin-mux.test.ts packages/runtime/test/attach-hint.test.ts packages/runtime/test/builtin-agent.test.ts` passes.
- Full baseline checks pass before PR merge.
