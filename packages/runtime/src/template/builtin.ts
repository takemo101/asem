/**
 * Builtin template definitions.
 *
 * These are raw, unparsed definitions (the same opaque shape a project-local
 * `.asem.yaml` would provide). The {@link createTemplateRegistry} parses both
 * builtins and project-local definitions through the identical typed path, so
 * builtins enjoy no special trust and no separate schema.
 *
 * The sequences here are intentionally minimal starters that exercise the
 * sequence engine and `_shell` interpolation. The exact, validated mux and
 * agent commands are owned by later slices (mux templates and agent templates);
 * this file only establishes that builtins resolve through the typed path.
 */

/** Raw builtin mux templates, keyed by name. */
export const builtinMuxTemplates: Readonly<Record<string, unknown>> = {
  herdr: {
    create: [
      {
        type: "run",
        command: "herdr pane split --print-id",
        capture: [{ name: "pane_id", regex: "^(.+)$" }],
      },
    ],
    run_in_pane: [
      {
        type: "run",
        command: "herdr pane send-text {{pane_id_shell}} {{launch_cmd_shell}}",
      },
    ],
    send: [
      {
        type: "run",
        command: "herdr pane send-text {{pane_id_shell}} {{message_shell}}",
      },
    ],
    attach: [{ type: "run", command: "herdr pane focus {{pane_id_shell}}" }],
    close: [{ type: "run", command: "herdr pane close {{pane_id_shell}}" }],
  },
  tmux: {
    create: [
      {
        type: "run",
        command: "tmux new-window -P -F '#{pane_id}'",
        capture: [{ name: "pane_id", regex: "^(%\\d+)$", group: 1 }],
      },
    ],
    run_in_pane: [
      {
        type: "run",
        command: "tmux send-keys -t {{pane_id_shell}} {{launch_cmd_shell}} Enter",
      },
    ],
    send: [
      {
        type: "run",
        command: "tmux send-keys -t {{pane_id_shell}} {{message_shell}} Enter",
      },
    ],
    attach: [{ type: "run", command: "tmux select-pane -t {{pane_id_shell}}" }],
    close: [{ type: "run", command: "tmux kill-pane -t {{pane_id_shell}}" }],
  },
  zellij: {
    create: [{ type: "run", command: "zellij action new-pane" }],
    run_in_pane: [
      { type: "run", command: "zellij action write-chars {{launch_cmd_shell}}" },
    ],
    send: [
      { type: "run", command: "zellij action write-chars {{message_shell}}" },
    ],
    attach: [{ type: "run", command: "zellij action focus-next-pane" }],
    close: [{ type: "run", command: "zellij action close-pane" }],
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
