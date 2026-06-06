import { describe, expect, test } from "bun:test";
import {
  type CommandSequence,
  createTemplateRegistry,
  FakeTemplateRunner,
  type MuxTemplate,
  SequenceEngine,
} from "../src/index.ts";

/**
 * Builtin mux template tests (MIK-007).
 *
 * These exercise the herdr / tmux / zellij builtin mux templates entirely
 * through the {@link FakeTemplateRunner} — no real multiplexer binary is
 * required (implementation principle 4). They assert:
 *
 * - the `create` sequence's command order, cwd/env propagation, and the mux
 *   refs it captures;
 * - `send` and `close` command construction with shell-escaped variables;
 * - `attach` producing a human/operator attach command (never an MCP op);
 * - that a pane created by a mux template is addressed by **the same** mux
 *   template for `send` / `attach` / `close`, using only the captured refs
 *   (i.e. exactly what a later op would load from the Store).
 */

/** The base interpolation vars `create_session` provides to a `create` run. */
const BASE_VARS: Record<string, string> = {
  session_id: "s_0001",
  cwd: "/repo",
  name: "reviewer-1",
  launch_cmd: "bash '/repo/.asem/sessions/s_0001/launch.sh'",
};

/** A Message body containing a space + shell metachar to prove `_shell` use. */
const MESSAGE = "hi; there";

function muxTemplate(name: string): MuxTemplate {
  const template = createTemplateRegistry().getMuxTemplate(name);
  expect(template).toBeDefined();
  return template as MuxTemplate;
}

function engine(runner: FakeTemplateRunner): SequenceEngine {
  return new SequenceEngine({ runner });
}

async function runCreate(
  template: MuxTemplate,
  runner: FakeTemplateRunner,
  context: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Record<string, string>> {
  const result = await engine(runner).run(template.create, {
    cwd: context.cwd ?? "/repo",
    ...(context.env ? { env: context.env } : {}),
    variables: BASE_VARS,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("create failed");
  return result.value.captures;
}

/** Run a non-create sequence with ONLY the captured refs + message available. */
async function runWithRefsOnly(
  sequence: CommandSequence,
  runner: FakeTemplateRunner,
  refs: Record<string, string>,
): Promise<void> {
  const result = await engine(runner).run(sequence, {
    cwd: "/repo",
    // Captured refs + the op-provided vars (`launch_cmd` for run_in_pane,
    // `message` for send). Base create vars like `name`/`cwd` are deliberately
    // absent, mirroring a later op that only has the Store muxRef.
    variables: { ...refs, message: MESSAGE, launch_cmd: BASE_VARS.launch_cmd! },
  });
  expect(result.ok).toBe(true);
}

const commandsOf = (runner: FakeTemplateRunner): string[] =>
  runner.commands.map((c) => c.command);

// --- herdr ----------------------------------------------------------------

describe("builtin mux: herdr", () => {
  // herdr's CLI emits JSON; `create` captures pane_id + tab_id via JSONPath.
  const HERDR_CREATE_JSON = JSON.stringify({
    result: { root_pane: { pane_id: "w-3" }, tab: { tab_id: "w:2" } },
  });

  test("create: command, cwd/env propagation, and captured refs", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: HERDR_CREATE_JSON }],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]!.command).toBe(
      "herdr tab create --cwd '/repo' --no-focus --label 'reviewer-1'",
    );
    expect(runner.commands[0]!.cwd).toBe("/repo");
    expect(runner.commands[0]!.env).toEqual({ AS_X: "1" });
    // Enough ref data for later send/attach/close.
    expect(refs).toEqual({ pane_id: "w-3", tab_id: "w:2" });
  });

  test("run_in_pane runs the launch command in the captured pane", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, { pane_id: "w-3" });
    expect(commandsOf(runner)).toEqual([
      "herdr pane run 'w-3' 'bash '\\''/repo/.asem/sessions/s_0001/launch.sh'\\'''",
    ]);
  });

  test("send writes text then Enter, shell-escaping the message", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, { pane_id: "w-3" });
    expect(commandsOf(runner)).toEqual([
      "herdr pane send-text 'w-3' 'hi; there'",
      "herdr pane send-keys 'w-3' Enter",
    ]);
  });

  test("attach is an operator command targeting the captured pane", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, { pane_id: "w-3" });
    expect(commandsOf(runner)).toEqual(["herdr agent attach 'w-3'"]);
  });

  test("close closes the captured pane", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, { pane_id: "w-3" });
    expect(commandsOf(runner)).toEqual(["herdr pane close 'w-3'"]);
  });
});

// --- tmux -----------------------------------------------------------------

describe("builtin mux: tmux", () => {
  // `new-window -P -F` prints a `|`-delimited line; create captures all three.
  const TMUX_CREATE_OUT = "main|@3|%5\n";

  test("create: command, cwd/env propagation, and captured refs", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: TMUX_CREATE_OUT }],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    expect(runner.commands[0]!.command).toBe(
      "tmux new-window -P -F '#{session_name}|#{window_id}|#{pane_id}' -c '/repo' -n 'reviewer-1'",
    );
    expect(runner.commands[0]!.cwd).toBe("/repo");
    expect(runner.commands[0]!.env).toEqual({ AS_X: "1" });
    expect(refs).toEqual({
      session_name: "main",
      window_id: "@3",
      pane_id: "%5",
    });
  });

  test("run_in_pane sends the launch command then Enter", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, { pane_id: "%5" });
    expect(commandsOf(runner)).toEqual([
      "tmux send-keys -t '%5' 'bash '\\''/repo/.asem/sessions/s_0001/launch.sh'\\''' Enter",
    ]);
  });

  test("send sends the shell-escaped message then Enter", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, { pane_id: "%5" });
    expect(commandsOf(runner)).toEqual([
      "tmux send-keys -t '%5' 'hi; there' Enter",
    ]);
  });

  test("attach selects the captured window+pane then attaches", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, {
      session_name: "main",
      window_id: "@3",
      pane_id: "%5",
    });
    expect(commandsOf(runner)).toEqual([
      "tmux select-window -t '@3'",
      "tmux select-pane -t '%5'",
      "tmux attach-session -t 'main'",
    ]);
  });

  test("close kills the captured pane", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, { pane_id: "%5" });
    expect(commandsOf(runner)).toEqual(["tmux kill-pane -t '%5'"]);
  });
});

// --- zellij ---------------------------------------------------------------

describe("builtin mux: zellij", () => {
  test("create: command, cwd/env propagation, and captured tab name", async () => {
    const template = muxTemplate("zellij");
    // [0] new-tab (no useful stdout); [1] printf echoes the name we capture.
    const runner = new FakeTemplateRunner({
      commands: [{}, { stdout: "s_0001" }],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    expect(commandsOf(runner)).toEqual([
      "zellij action new-tab --name 's_0001' --cwd '/repo'",
      "printf '%s' 's_0001'",
    ]);
    expect(runner.commands[0]!.cwd).toBe("/repo");
    expect(runner.commands[0]!.env).toEqual({ AS_X: "1" });
    expect(refs).toEqual({ tab_name: "s_0001" });
  });

  test("run_in_pane focuses the tab, writes the launch command, presses Enter", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, { tab_name: "s_0001" });
    expect(commandsOf(runner)).toEqual([
      "zellij action go-to-tab-name 's_0001'",
      "zellij action write-chars 'bash '\\''/repo/.asem/sessions/s_0001/launch.sh'\\'''",
      "zellij action write 13",
    ]);
  });

  test("send focuses the tab, writes the message, presses Enter", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, { tab_name: "s_0001" });
    expect(commandsOf(runner)).toEqual([
      "zellij action go-to-tab-name 's_0001'",
      "zellij action write-chars 'hi; there'",
      "zellij action write 13",
    ]);
  });

  test("attach focuses the captured tab", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, { tab_name: "s_0001" });
    expect(commandsOf(runner)).toEqual([
      "zellij action go-to-tab-name 's_0001'",
    ]);
  });

  test("close focuses the captured tab then closes it", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, { tab_name: "s_0001" });
    expect(commandsOf(runner)).toEqual([
      "zellij action go-to-tab-name 's_0001'",
      "zellij action close-tab",
    ]);
  });
});

// --- cross-cutting: same template addresses the pane it created ------------

describe("builtin mux: a created pane is addressed by the same template", () => {
  // Each case scripts the `create` stdout and the var each later sequence keys
  // on. The captures from `create` are the ONLY inputs threaded into
  // send/attach/close — exactly what a later op loads from the Store as muxRef.
  const cases = [
    {
      name: "herdr",
      createScript: [
        {
          stdout: JSON.stringify({
            result: { root_pane: { pane_id: "w-7" }, tab: { tab_id: "w:9" } },
          }),
        },
      ],
      addressedBy: "w-7",
    },
    {
      name: "tmux",
      createScript: [{ stdout: "dev|@1|%12\n" }],
      addressedBy: "%12",
    },
    {
      name: "zellij",
      createScript: [{}, { stdout: "s_0001" }],
      addressedBy: "s_0001",
    },
  ] as const;

  for (const c of cases) {
    test(`${c.name}: send/attach/close reuse the create refs`, async () => {
      const template = muxTemplate(c.name);

      const createRunner = new FakeTemplateRunner({
        commands: [...c.createScript],
      });
      const refs = await runCreate(template, createRunner);

      for (const sequence of [template.send, template.attach, template.close]) {
        const runner = new FakeTemplateRunner();
        // Pass ONLY the captured refs (+ message): proves the create refs are
        // sufficient to address the same pane later.
        await runWithRefsOnly(sequence, runner, refs);
        const joined = commandsOf(runner).join("\n");
        expect(joined).toContain(c.addressedBy);
      }
    });
  }
});
