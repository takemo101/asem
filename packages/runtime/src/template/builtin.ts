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
 *   the ref from the Store) can address the same pane; a ref already derivable
 *   from the create base vars (e.g. a session name set from the Session id) is
 *   declared in the template's `refs` map instead of being re-captured from a
 *   fake echo step — captures win over a `refs` entry of the same name;
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
    create: [
      {
        type: "run",
        command: "printf '%s' \"${HERDR_SESSION:-default}\"",
        capture: [{ name: "herdr_session", regex: "^(.+)$", group: 1 }],
      },
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} workspace create --cwd {{cwd_shell}} --label {{session_id_shell}}",
        capture: [
          { name: "pane_id", jsonpath: "$.result.root_pane.pane_id" },
          { name: "tab_id", jsonpath: "$.result.tab.tab_id" },
          {
            name: "herdr_workspace_id",
            jsonpath: "$.result.workspace.workspace_id",
          },
        ],
      },
    ],
    run_in_pane: [
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} pane run {{pane_id_shell}} {{launch_cmd_shell}}",
      },
    ],
    send: [
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} wait agent-status {{pane_id_shell}} --status idle --timeout 30000",
        on_error: "ignore",
      },
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} pane run {{pane_id_shell}} {{message_shell}}",
      },
    ],
    attach: [
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} workspace focus {{herdr_workspace_id_shell}} >/dev/null && herdr --session {{herdr_session_shell}} tab focus {{tab_id_shell}} >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach {{herdr_session_shell}}; fi",
      },
    ],
    attach_command: [
      "sh",
      "-c",
      "herdr --session {{herdr_session_shell}} workspace focus {{herdr_workspace_id_shell}} >/dev/null && herdr --session {{herdr_session_shell}} tab focus {{tab_id_shell}} >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach {{herdr_session_shell}}; fi",
    ],
    close: [
      {
        type: "run",
        command:
          "herdr --session {{herdr_session_shell}} workspace close {{herdr_workspace_id_shell}}",
      },
    ],
  },

  /**
   * tmux — the session name is the Session id (`-s {{session_id}}`), so it is
   * declared as a ref rather than re-captured from output; `create` only
   * captures the pane id (`%N`) that `new-session -P -F` prints, which
   * addresses `send-keys`/`kill-pane`/`select-pane`.
   */
  tmux: {
    refs: { tmux_session_name: "{{session_id}}" },
    create: [
      {
        type: "run",
        command:
          "tmux new-session -d -s {{session_id_shell}} -c {{cwd_shell}} -P -F '#{pane_id}'",
        capture: [{ name: "pane_id", regex: "^(\\S+)\\s*$", group: 1 }],
      },
    ],
    run_in_pane: [
      {
        type: "run",
        command:
          "tmux send-keys -t {{tmux_session_name_shell}} -l {{launch_cmd_shell}}",
      },
      { type: "wait_ms", ms: 200 },
      {
        type: "run",
        command: "tmux send-keys -t {{tmux_session_name_shell}} Enter",
      },
    ],
    send: [
      {
        type: "run",
        command:
          "tmux send-keys -t {{tmux_session_name_shell}} -l {{message_shell}}",
      },
      { type: "wait_ms", ms: 200 },
      {
        type: "run",
        command: "tmux send-keys -t {{tmux_session_name_shell}} Enter",
      },
    ],
    attach: [
      {
        type: "run",
        command: "tmux attach-session -t {{tmux_session_name_shell}}",
      },
    ],
    attach_command: ["tmux", "attach-session", "-t", "{{tmux_session_name}}"],
    close: [
      {
        type: "run",
        command: "tmux kill-session -t {{tmux_session_name_shell}}",
      },
    ],
  },

  /**
   * zellij — follows cuekit's proven detached-session model. zellij cannot
   * reliably apply `action write-chars` to a freshly-created background session
   * with no attached clients, so create starts the launch script as the initial
   * layout pane via `--default-layout`; `run_in_pane` is intentionally a no-op.
   * Later steering targets the known initial pane (`terminal_0`). macOS temp
   * paths can exceed zellij's socket length limit, so builtin commands default
   * `ZELLIJ_SOCKET_DIR` to `/tmp/zellij` while respecting an existing override.
   */
  zellij: {
    // The zellij session name is the Session id, declared as a ref — no
    // capture-only echo step is needed to record it.
    refs: { zellij_session_name: "{{session_id}}" },
    create: [
      {
        type: "write_file",
        path: "{{session_dir}}/zellij-layout.kdl",
        contents:
          'layout {\n  pane command="bash" cwd="{{cwd_kdl}}" close_on_exit=false {\n    args "{{launch_script_kdl}}"\n  }\n}\n',
      },
      {
        type: "run",
        command:
          'mkdir -p "${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" && ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij attach --create-background {{session_id_shell}} options --default-cwd {{cwd_shell}} --default-layout {{session_dir_shell}}/zellij-layout.kdl',
      },
    ],
    run_in_pane: [],
    send: [
      {
        type: "run",
        command:
          'ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij --session {{zellij_session_name_shell}} action write-chars --pane-id terminal_0 {{message_shell}}',
      },
      { type: "wait_ms", ms: 200 },
      {
        type: "run",
        command:
          'ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij --session {{zellij_session_name_shell}} action write --pane-id terminal_0 13',
      },
    ],
    attach: [
      {
        type: "run",
        command:
          'mkdir -p "${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" && ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij attach {{zellij_session_name_shell}}',
      },
    ],
    attach_command: [
      "sh",
      "-c",
      'mkdir -p "${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" && ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" exec zellij attach {{zellij_session_name_shell}}',
    ],
    close: [
      {
        type: "run",
        command:
          'ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij kill-session {{zellij_session_name_shell}}',
        on_error: "ignore",
      },
      {
        type: "run",
        command:
          'ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij delete-session {{zellij_session_name_shell}}',
        on_error: "ignore",
      },
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
