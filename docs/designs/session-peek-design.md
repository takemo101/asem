# Session peek live pane snapshot design

## Summary

`session peek` lets a human operator or parent Session inspect a live child
Session's multiplexer pane output without attaching to the pane and without
creating durable transcript state.

The feature is a read-only live snapshot operation:

- it reads the target Session's current multiplexer pane output;
- it returns recent text by default, not a stored Message/Report history;
- it does not infer task status, completion, success, failure, blocked state, or
  read/unread state;
- it does not mutate Session status when the pane read fails.

This fills the gap between:

- `session attach`, which is human-only and takes over/focuses the terminal; and
- `message list`, which reads durable asem Messages/Reports but not the Agent
  CLI's live terminal output.

## Vocabulary

**Peek**:
A read-only operation that retrieves a best-effort live snapshot of a Session's
multiplexer pane output.

**Pane snapshot**:
The text returned by one mux `peek` command invocation. It is not persisted by
asem and is not a transcript.

**Peek source**:
The requested shape of terminal text:

- `visible` — current viewport only;
- `recent` — recent scrollback as rendered by the multiplexer;
- `recent-unwrapped` — recent scrollback with terminal soft wraps joined when
  the multiplexer can provide that exact shape.

`recent-unwrapped` is the default because parent Sessions and MCP clients need
text that is stable across terminal widths.

## Goals

- Let a parent Session inspect child Session output through asem instead of
  calling `herdr`/`tmux`/`rmux`/`zellij` directly.
- Provide both CLI and MCP surfaces.
- Keep the operation read-only and best-effort.
- Preserve Workspace as the normal safety boundary.
- Reuse mux templates rather than introducing fixed TypeScript mux adapters.
- Support all builtin mux templates when their CLIs can satisfy the requested
  source exactly.

## Non-goals

- No durable transcript storage.
- No continuous tail/watch mode.
- No read/unread state.
- No automatic result or task outcome interpretation.
- No Session status mutation on peek failure.
- No redaction or content rewriting of pane output.
- No TUI embedding in the first slice.

## Public surfaces

### CLI

```sh
asem session peek <session-id> [--source visible|recent|recent-unwrapped] [--lines N]
asem session peek <session-id> --json
```

Defaults:

- `source`: `recent-unwrapped`
- `lines`: `80`
- maximum `lines`: `300`

Normal text output prints the snapshot content only, so it can be piped or read
quickly. `--json` prints the structured operation result.

### MCP

Add an MCP tool, tentatively named `peek_session`, with input equivalent to:

```ts
{
  id: string;
  source?: "visible" | "recent" | "recent-unwrapped";
  lines?: number;
}
```

The MCP output is structured so parent agents can inspect metadata and content
without parsing human text.

## Operation contract

Add shared core operation contracts:

```ts
type PeekSource = "visible" | "recent" | "recent-unwrapped";

interface PeekSessionInput {
  id: string;
  source?: PeekSource;
  lines?: number;
}

interface PeekSessionOutput {
  session: Session;
  source: PeekSource;
  lines: number;
  content: string;
}
```

Validation rules:

- `lines` defaults to `80`.
- `lines` must be a positive integer.
- `lines` must be at most `300`.
- `source` defaults to `recent-unwrapped`.

## Scope and authorization

Human/operator CLI uses local trust, matching other human CLI inspection
operations.

MCP/agent access is allowed for any target Session in the same Workspace as the
verified current Session. This mirrors Workspace as the communication and local
collaboration boundary.

Cross-Workspace peek is forbidden.

Because pane output may contain secrets, documentation must state that `peek`
returns live terminal text without redaction. Callers should not use it across
trust boundaries.

## Mux template shape

Extend `MuxTemplate` with an optional `peek` command sequence:

```yaml
peek: []
```

`peek` is a foreground read-only command sequence. Its output contract is:

- the final foreground `run` step's stdout is the pane snapshot;
- background `run` steps are invalid or ignored for output purposes;
- if the sequence has no foreground `run` step, the mux does not support peek;
- if a command exits non-zero, the operation fails with a structured peek error;
- requested `source` and `lines` are available as interpolation variables.

The operation should pass these variables to the sequence:

```text
{{peek_source}}
{{peek_source_shell}}
{{peek_lines}}
{{peek_lines_shell}}
```

Mux-specific refs from `session.muxRef` are available the same way they are for
`send`, `attach`, and `close`.

### Sequence engine support

The current `SequenceEngine.run()` returns captures and background handles, not
stdout. Add a small runtime helper or mode for peek that returns the final
foreground `run` stdout while preserving the same interpolation, timeout,
redaction-for-errors, and `on_error` behavior.

Do not overload the existing template-step `capture` concept for pane snapshots;
`capture` remains the internal stdout/stderr extraction mechanism for refs.

## Builtin mux behavior

Builtin mux templates should define `peek` for:

- `herdr`
- `tmux`
- `rmux`
- `zellij`

The exact commands must be verified during implementation. Expected directions:

- herdr: `herdr pane read {{pane_id_shell}} --source {{peek_source_shell}} --lines {{peek_lines_shell}}`
- tmux: `tmux capture-pane` with options mapped exactly to `visible`, `recent`,
  and `recent-unwrapped`.
- rmux: tmux-like capture commands when supported; unsupported exact sources must
  return explicit `unsupported_source` rather than silently degrading.
- zellij: `zellij action dump-screen` when it can satisfy the requested source
  exactly.

If a mux cannot provide the requested source exactly, return a structured
`unsupported_source` error. Do not silently fall back to another source.

## Errors

Suggested structured error cases:

- `session_not_found` — target Session does not exist in the resolved Workspace.
- `invalid_input` — invalid `lines` or `source`.
- `mux_template_not_found` — target mux template is unavailable.
- `mux_peek_unsupported` — mux template has no usable `peek` sequence.
- `unsupported_source` — mux cannot satisfy the requested source exactly.
- `peek_failed` — mux command failed or pane could not be read.
- `timeout` — mux read timed out.

`peek_failed` and `timeout` must not update Session status. Operators can run
`session get --refresh` or explicit close/recovery commands when they want to
refresh liveness.

## Rendering

CLI human text mode:

- print `content` only;
- do not add headers by default;
- preserve trailing/newline behavior as much as practical without adding extra
  semantic lines.

CLI JSON/MCP mode:

```json
{
  "session": { "id": "s_...", "name": "worker", "mux": "herdr" },
  "source": "recent-unwrapped",
  "lines": 80,
  "content": "..."
}
```

The exact `session` shape should reuse the existing `Session` projection used by
other operation outputs.

## Tests

Use TDD.

Core/ops tests:

- rejects `lines <= 0` and `lines > 300`;
- defaults source to `recent-unwrapped` and lines to `80`;
- forbids cross-Workspace target Sessions;
- allows same-Workspace target Sessions;
- returns content from the final foreground `run` stdout;
- missing `peek` sequence returns `mux_peek_unsupported`;
- mux command failure returns `peek_failed` or existing structured
  `sequence_step_failed` mapped to peek context;
- failure does not mutate Session status.

Runtime tests:

- schema parses mux templates with optional `peek`;
- peek runner returns final foreground run stdout;
- `source` and `lines` interpolate into commands;
- builtins define peek commands for all supported muxes;
- integration tests for real mux CLIs remain optional/skipped when binaries or
  live mux environments are unavailable.

CLI tests:

- `asem session peek <id>` renders content only;
- `--json` renders structured output;
- source/lines parse and validate;
- errors render actionable messages.

MCP tests:

- `peek_session` tool schema exposes `id`, `source`, and `lines`;
- tool returns structured content;
- same-Workspace authorization behavior matches ops.

## Documentation updates

When implemented, update:

- CLI manual and README with `session peek` examples;
- MCP/Skills guidance so parent agents know to use `peek_session` for live
  child-output inspection;
- mux template design notes documenting the optional `peek` sequence.
