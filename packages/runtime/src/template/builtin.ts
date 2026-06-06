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

/** Raw builtin mux templates, keyed by name. */
export const builtinMuxTemplates: Readonly<Record<string, unknown>> = {
  /**
   * herdr — the asem-native multiplexer. Its CLI speaks JSON over the session
   * socket, so `create` captures the new pane/tab ids via JSONPath. A pane id
   * (`w…-N`) addresses `pane run`/`send-text`/`send-keys`/`close`; the tab id
   * is captured too as durable ref data. `attach` is the operator command
   * `herdr agent attach`, which brings a human to the pane — not an MCP op.
   */
  herdr: {
    // `tab create` returns the new tab plus its root pane as JSON. A new tab
    // (not a split) keeps each Session isolated; `--no-focus` avoids stealing
    // the operator's focus when a Session is created in the background.
    create: [
      {
        type: "run",
        command:
          "herdr tab create --cwd {{cwd_shell}} --no-focus --label {{name_shell}}",
        capture: [
          { name: "pane_id", jsonpath: "$.result.root_pane.pane_id" },
          { name: "tab_id", jsonpath: "$.result.tab.tab_id" },
        ],
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
        command: "herdr pane send-text {{pane_id_shell}} {{message_shell}}",
      },
      {
        type: "run",
        command: "herdr pane send-keys {{pane_id_shell}} Enter",
      },
    ],
    attach: [
      { type: "run", command: "herdr agent attach {{pane_id_shell}}" },
    ],
    close: [{ type: "run", command: "herdr pane close {{pane_id_shell}}" }],
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

/** Raw builtin agent templates, keyed by name. */
export const builtinAgentTemplates: Readonly<Record<string, unknown>> = {
  claude: {
    command: "claude",
    prompt_delivery: "arg",
  },
  codex: {
    command: "codex",
    prompt_delivery: "arg",
  },
};
