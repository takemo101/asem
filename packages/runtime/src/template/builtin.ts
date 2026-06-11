/**
 * Builtin template definitions.
 *
 * These are raw, unparsed definitions (the same opaque shape a project-local
 * `.asem.yaml` would provide). The {@link createTemplateRegistry} parses both
 * builtins and project-local definitions through the identical typed path, so
 * builtins enjoy no special trust and no separate schema.
 *
 * ## Mux templates (herdr / tmux / zellij)
 *
 * Each mux template owns only multiplexer pane/session control. It never encodes
 * agent prompt semantics or Session outcome interpretation — those belong to the
 * agent templates and to the human/agent using asem. Every template exposes the
 * five sequences from the design:
 *
 * - `create` — make a pane/tab and **capture enough mux ref data** that the
 *   later sequences (and a future `send_message` / `close_session` op loading
 *   the ref from the Store) can address the same pane;
 * - `run_in_pane` — run the Session launch script in that pane;
 * - `send` — inject a Message into the pane (text, then Enter);
 * - `attach` — a human/operator attach command (never an MCP operation);
 * - `close` — close the pane/tab.
 *
 * Command interpolation always uses the `_shell` variants so values flow through
 * the centralized `@asem/core` shell escaping (implementation principle 9); the
 * runtime never invents its own escaping. The variables `create` may rely on are
 * the `create_session` base vars (`cwd`, `name`, `session_id`, …); every later
 * sequence relies on the refs captured by `create` plus the operation's own vars
 * (`launch_cmd` for `run_in_pane`, `message` for `send`).
 */

const HERDR_RESOLVE_PANE_BY_LABEL =
  'HERDR_SESSION={{herdr_session_shell}} HERDR_LABEL={{herdr_label_shell}} HERDR_WORKSPACE_ID={{herdr_workspace_id_shell}} python3 -c \'exec("""import json, os, shlex, subprocess\nlabel = os.environ["HERDR_LABEL"]\nworkspace = os.environ["HERDR_WORKSPACE_ID"]\ntabs = json.loads(subprocess.check_output(["herdr", "tab", "list", "--workspace", workspace], text=True))["result"]["tabs"]\ntab = next((t for t in tabs if t.get("label") == label), None)\nassert tab is not None, "herdr tab label not found"\npanes = json.loads(subprocess.check_output(["herdr", "pane", "list", "--workspace", workspace], text=True))["result"]["panes"]\npane = next((p for p in panes if p.get("tab_id") == tab.get("tab_id")), None)\nassert pane is not None, "herdr pane for tab not found"\nprint("tab_id=" + shlex.quote(tab["tab_id"]))\nprint("pane_id=" + shlex.quote(pane["pane_id"]))\n""")\'';

const HERDR_RESOLVE_PANE_VAR = `eval "$(${HERDR_RESOLVE_PANE_BY_LABEL})"`;

/** Raw builtin mux templates, keyed by name. */
export const builtinMuxTemplates: Readonly<Record<string, unknown>> = {
  /**
   * herdr — the asem-native multiplexer. Its CLI speaks JSON over the session
   * socket. herdr's display pane/tab ids can compact when panes close, so they
   * are captured as initial refs only; later send/attach/close commands resolve
   * the current pane by the stable Session-id tab label in the same workspace.
   * `attach` focuses that pane and then opens the current herdr session UI — not
   * an MCP op.
   */
  herdr: {
    // `tab create` returns the new tab plus its root pane as JSON. A new tab
    // (not a split) keeps each Session isolated; `--no-focus` avoids stealing
    // the operator's focus when a Session is created in the background. The tab
    // label uses the Session id because it is unique and stable; the human
    // Session name remains in the durable Session row and TUI/CLI surfaces.
    create: [
      {
        type: "run",
        command:
          "herdr tab create --cwd {{cwd_shell}} --no-focus --label {{session_id_shell}}",
        capture: [
          { name: "pane_id", jsonpath: "$.result.root_pane.pane_id" },
          { name: "tab_id", jsonpath: "$.result.tab.tab_id" },
          { name: "herdr_workspace_id", jsonpath: "$.result.tab.workspace_id" },
        ],
      },
      {
        type: "run",
        command: "printf '%s' {{session_id_shell}}",
        capture: [{ name: "herdr_label", regex: "^(.+)$", group: 1 }],
      },
      {
        type: "run",
        command: "printf '%s' \"${HERDR_SESSION:-default}\"",
        capture: [{ name: "herdr_session", regex: "^(.+)$", group: 1 }],
      },
    ],
    // `pane run` writes the command text and presses Enter, so the launch
    // script starts in one step.
    run_in_pane: [
      {
        type: "run",
        command: "herdr pane run {{pane_id_shell}} {{launch_cmd_shell}}",
      },
    ],
    // `send-text` writes literal text only; Enter is a separate key press, so
    // a delivered Message lands as input and is submitted.
    send: [
      {
        type: "run",
        command: `${HERDR_RESOLVE_PANE_VAR} && HERDR_SESSION={{herdr_session_shell}} herdr pane send-text "$pane_id" {{message_shell}}`,
      },
      {
        type: "run",
        command: `${HERDR_RESOLVE_PANE_VAR} && HERDR_SESSION={{herdr_session_shell}} herdr pane send-keys "$pane_id" Enter`,
      },
    ],
    attach: [
      {
        type: "run",
        command:
          HERDR_RESOLVE_PANE_VAR +
          ' && HERDR_SESSION={{herdr_session_shell}} herdr tab focus "$tab_id" && herdr session attach {{herdr_session_shell}}',
      },
    ],
    close: [
      {
        type: "run",
        command: `${HERDR_RESOLVE_PANE_VAR} && HERDR_SESSION={{herdr_session_shell}} herdr pane close "$pane_id"`,
      },
    ],
  },

  /**
   * tmux — `new-window -P -F` prints a `|`-delimited line so `create` captures
   * the session name, window id, and pane id. The pane id (`%N`) addresses
   * `send-keys`/`kill-pane`/`select-pane`; the session name + window id let
   * `attach` bring an operator to exactly that pane.
   */
  tmux: {
    create: [
      {
        type: "run",
        command:
          "tmux new-window -P -F '#{session_name}|#{window_id}|#{pane_id}' -c {{cwd_shell}} -n {{name_shell}}",
        capture: [
          { name: "session_name", regex: "^([^|]*)\\|", group: 1 },
          { name: "window_id", regex: "^[^|]*\\|([^|]*)\\|", group: 1 },
          // Trailing `\s*$` drops the newline `tmux -P` prints after the line.
          { name: "pane_id", regex: "\\|([^|\\s]+)\\s*$", group: 1 },
        ],
      },
    ],
    // `send-keys … Enter` sends the literal text then the Enter key.
    run_in_pane: [
      {
        type: "run",
        command:
          "tmux send-keys -t {{pane_id_shell}} {{launch_cmd_shell}} Enter",
      },
    ],
    send: [
      {
        type: "run",
        command: "tmux send-keys -t {{pane_id_shell}} {{message_shell}} Enter",
      },
    ],
    // Operator attach: select the captured window + pane, then attach to the
    // session so the human lands on exactly that pane.
    attach: [
      { type: "run", command: "tmux select-window -t {{window_id_shell}}" },
      { type: "run", command: "tmux select-pane -t {{pane_id_shell}}" },
      {
        type: "run",
        command: "tmux attach-session -t {{session_name_shell}}",
      },
    ],
    close: [{ type: "run", command: "tmux kill-pane -t {{pane_id_shell}}" }],
  },

  /**
   * zellij — its CLI addresses tabs by **name**, not by a stable id, so each
   * Session gets a named tab (named by `session_id`). `new-tab` prints only a
   * numeric id, so `create` records the stable name we assigned as the mux ref
   * (`tab_name`); every later sequence focuses that tab via `go-to-tab-name`
   * before acting. Enter is the CR byte (`write 13`).
   */
  zellij: {
    create: [
      {
        type: "run",
        command:
          "zellij action new-tab --name {{session_id_shell}} --cwd {{cwd_shell}}",
      },
      // Record the stable tab name as the addressable mux ref. zellij gives no
      // stable id back, so we echo the name we set and capture it.
      {
        type: "run",
        command: "printf '%s' {{session_id_shell}}",
        capture: [{ name: "tab_name", regex: "^(.+)$", group: 1 }],
      },
    ],
    run_in_pane: [
      {
        type: "run",
        command: "zellij action go-to-tab-name {{tab_name_shell}}",
      },
      {
        type: "run",
        command: "zellij action write-chars {{launch_cmd_shell}}",
      },
      { type: "run", command: "zellij action write 13" },
    ],
    send: [
      {
        type: "run",
        command: "zellij action go-to-tab-name {{tab_name_shell}}",
      },
      {
        type: "run",
        command: "zellij action write-chars {{message_shell}}",
      },
      { type: "run", command: "zellij action write 13" },
    ],
    // Operator attach: focus the Session's tab.
    attach: [
      {
        type: "run",
        command: "zellij action go-to-tab-name {{tab_name_shell}}",
      },
    ],
    // Focus the tab, then close the focused tab.
    close: [
      {
        type: "run",
        command: "zellij action go-to-tab-name {{tab_name_shell}}",
      },
      { type: "run", command: "zellij action close-tab" },
    ],
  },
};

/**
 * Raw builtin agent templates, keyed by name.
 *
 * An agent template owns only two things: the agent **command** (binary plus any
 * fixed flags) and the **prompt delivery mode**. It must not own multiplexer
 * lifecycle or Session outcome interpretation. `prompt_delivery` is one of
 * `arg | stdin | file | paste`; `after_start` is an optional sequence used
 * mainly by the `paste` flow to give the agent time to boot before the operation
 * pastes the prompt via the mux `send` sequence.
 *
 * Regardless of delivery mode, `create_session` always writes the prompt to
 * `prompt.md` for audit/debug, and the rendered launch command never contains
 * the raw Session token — the token is injected via env by the launch script
 * (see {@link renderAgentCommand} and the `create_session` launch flow).
 *
 * ## Verified CLI flag assumptions
 *
 * The commands below were verified against each CLI's `--help` on macOS,
 * 2026-06-06. Each CLI starts an **interactive** session in the pane, so the
 * delivery mode is chosen to seed the initial prompt without breaking
 * interactivity (a redirected stdin would close the agent's TTY input, so
 * `stdin`/`file` are intentionally not used by these interactive builtins — they
 * remain supported by the engine and are covered by the delivery-mode tests):
 *
 * - **claude** — `claude [prompt]`: a positional prompt starts an interactive
 *   session seeded with it ("starts an interactive session by default"). → `arg`.
 * - **codex** — `codex [PROMPT]`: optional positional prompt; "If no subcommand
 *   is specified, options will be forwarded to the interactive CLI." → `arg`.
 * - **pi** — `pi [@files...] [messages...]`: a positional message seeds the
 *   interactive session (interactive unless `--print`). → `arg`.
 * - **gemini** — `gemini [query..]`: the positional query is the "Initial
 *   prompt. Runs in interactive mode by default" (`-p` is the headless flag we
 *   deliberately avoid). → `arg`.
 * - **agy** — `agy --prompt-interactive <text>` ("Run an initial prompt
 *   interactively and continue the session"). The flag lives in `command`, and
 *   `arg` delivery appends the prompt as its value. → `command: "agy -i"`, `arg`.
 * - **opencode** — `opencode [project]` starts the TUI with no initial-prompt
 *   positional (`opencode run [message]` is the non-interactive form we avoid),
 *   so the prompt cannot be passed as an argument. The agent starts bare and the
 *   prompt is pasted afterwards. → `paste`, with an `after_start` boot delay.
 */
export const builtinAgentTemplates: Readonly<Record<string, unknown>> = {
  // `arg`: positional prompt seeds the interactive session.
  claude: {
    command: "claude",
    prompt_delivery: "arg",
  },
  // `arg`: positional PROMPT forwarded to the interactive CLI.
  codex: {
    command: "codex",
    prompt_delivery: "arg",
  },
  // `arg`: positional message seeds the interactive session.
  pi: {
    command: "pi",
    prompt_delivery: "arg",
  },
  // `arg`: positional query is the initial interactive prompt.
  gemini: {
    command: "gemini",
    prompt_delivery: "arg",
  },
  // `arg` with the interactive-prompt flag baked into the command: the prompt
  // becomes the value of `agy --prompt-interactive`.
  agy: {
    command: "agy -i",
    prompt_delivery: "arg",
  },
  // `paste`: the TUI has no initial-prompt argument, so start bare and let the
  // mux `send` sequence paste the prompt after a short boot delay.
  opencode: {
    command: "opencode",
    prompt_delivery: "paste",
    after_start: [{ type: "wait_ms", ms: 750 }],
  },
};
