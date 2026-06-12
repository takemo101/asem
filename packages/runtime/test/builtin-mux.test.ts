import { describe, expect, test } from "bun:test";
import {
  type CommandSequence,
  createTemplateRegistry,
  FakeTemplateRunner,
  interpolateValues,
  type MuxTemplate,
  SequenceEngine,
} from "../src/index.ts";

/**
 * Builtin mux template tests (MIK-007).
 *
 * These exercise the herdr / tmux / zellij builtin mux templates entirely
 * through the FakeTemplateRunner — no real multiplexer binary is required.
 */

const BASE_VARS: Record<string, string> = {
  session_id: "s_0001",
  cwd: "/repo",
  cwd_kdl: "/repo",
  name: "reviewer-1",
  session_dir: "/repo/.asem/sessions/s_0001",
  launch_script: "/repo/.asem/sessions/s_0001/launch.sh",
  launch_script_kdl: "/repo/.asem/sessions/s_0001/launch.sh",
  launch_cmd: "bash '/repo/.asem/sessions/s_0001/launch.sh'",
};

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
  // Mirror create_session: declared template refs interpolate from the base
  // vars and merge under the create captures (a capture wins on conflict).
  return {
    ...interpolateValues(template.refs, BASE_VARS),
    ...result.value.captures,
  };
}

async function runWithRefsOnly(
  sequence: CommandSequence,
  runner: FakeTemplateRunner,
  refs: Record<string, string>,
): Promise<void> {
  const result = await engine(runner).run(sequence, {
    cwd: "/repo",
    variables: { ...refs, message: MESSAGE, launch_cmd: BASE_VARS.launch_cmd! },
  });
  expect(result.ok).toBe(true);
}

const commandsOf = (runner: FakeTemplateRunner): string[] =>
  runner.commands.map((c) => c.command);

// --- herdr ----------------------------------------------------------------

describe("builtin mux: herdr", () => {
  const HERDR_CREATE_JSON = JSON.stringify({
    result: {
      workspace: { workspace_id: "w" },
      root_pane: { pane_id: "w-3" },
      tab: { tab_id: "w:2" },
    },
  });

  test("create: command, cwd/env propagation, and captured refs", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: "asem" }, { stdout: HERDR_CREATE_JSON }],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    expect(runner.commands).toHaveLength(2);
    expect(runner.commands[0]!.command).toBe(
      "printf '%s' \"${HERDR_SESSION:-default}\"",
    );
    expect(runner.commands[1]!.command).toBe(
      "herdr --session 'asem' workspace create --cwd '/repo' --label 's_0001'",
    );
    expect(runner.commands[1]!.cwd).toBe("/repo");
    expect(runner.commands[1]!.env).toEqual({ AS_X: "1" });
    expect(refs).toEqual({
      herdr_session: "asem",
      pane_id: "w-3",
      tab_id: "w:2",
      herdr_workspace_id: "w",
    });
  });

  test("run_in_pane runs the launch command in the captured pane", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, {
      pane_id: "w-3",
      herdr_session: "asem",
    });
    expect(commandsOf(runner)).toHaveLength(1);
    expect(commandsOf(runner)[0]).toContain(
      "herdr --session 'asem' pane run 'w-3'",
    );
    expect(commandsOf(runner)[0]).toContain(
      "/repo/.asem/sessions/s_0001/launch.sh",
    );
  });

  test("send waits for the target agent to be idle before injecting input", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, {
      pane_id: "w-3",
      herdr_session: "asem",
    });
    expect(commandsOf(runner)).toEqual([
      "herdr --session 'asem' wait agent-status 'w-3' --status idle --timeout 30000",
      "herdr --session 'asem' pane run 'w-3' 'hi; there'",
    ]);
  });

  test("attach focuses the captured workspace and tab", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, {
      herdr_workspace_id: "w",
      tab_id: "w:2",
      herdr_session: "asem",
    });
    expect(commandsOf(runner)).toEqual([
      "herdr --session 'asem' workspace focus 'w' >/dev/null && herdr --session 'asem' tab focus 'w:2' >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
    ]);
  });

  test("close closes the captured workspace", async () => {
    const template = muxTemplate("herdr");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, {
      herdr_workspace_id: "w",
      herdr_session: "asem",
    });
    expect(commandsOf(runner)).toEqual([
      "herdr --session 'asem' workspace close 'w'",
    ]);
  });
});

// --- tmux -----------------------------------------------------------------

describe("builtin mux: tmux", () => {
  const TMUX_CREATE_OUT = "%5\n";

  test("create: starts a detached session, captures the pane id, and declares the session name as a ref (no fake capture step)", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner({
      commands: [{ stdout: TMUX_CREATE_OUT }],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    // One real tmux command; the session name is known from base vars, so no
    // extra capture-only step runs.
    expect(runner.commands).toHaveLength(1);
    const command = runner.commands[0]!.command;
    expect(command).toContain("tmux new-session -d");
    expect(command).toContain("-s 's_0001'");
    expect(command).toContain("-c '/repo'");
    expect(runner.commands[0]!.cwd).toBe("/repo");
    expect(runner.commands[0]!.env).toEqual({ AS_X: "1" });
    expect(refs).toEqual({ tmux_session_name: "s_0001", pane_id: "%5" });
  });

  test("run_in_pane sends the launch command then Enter", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, {
      tmux_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toHaveLength(2);
    expect(commandsOf(runner)[0]).toContain("tmux send-keys -t 's_0001' -l");
    expect(commandsOf(runner)[0]).toContain(
      "/repo/.asem/sessions/s_0001/launch.sh",
    );
    expect(commandsOf(runner)[1]).toBe("tmux send-keys -t 's_0001' Enter");
    expect(runner.events.map((event) => event.type)).toEqual([
      "run",
      "wait_ms",
      "run",
    ]);
  });

  test("send sends literal text then Enter", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, {
      tmux_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toEqual([
      "tmux send-keys -t 's_0001' -l 'hi; there'",
      "tmux send-keys -t 's_0001' Enter",
    ]);
  });

  test("attach attaches by tmux session name", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, {
      tmux_session_name: "main",
    });
    expect(commandsOf(runner)).toEqual(["tmux attach-session -t 'main'"]);
  });

  test("close kills the tmux session", async () => {
    const template = muxTemplate("tmux");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, {
      tmux_session_name: "main",
    });
    expect(commandsOf(runner)).toEqual(["tmux kill-session -t 'main'"]);
  });
});

// --- zellij ---------------------------------------------------------------

describe("builtin mux: zellij", () => {
  test("create: declares the session name as a ref instead of a fake printf capture", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner({
      commands: [{}],
    });
    const refs = await runCreate(template, runner, {
      cwd: "/repo",
      env: { AS_X: "1" },
    });

    expect(runner.writes).toHaveLength(1);
    expect(runner.writes[0]!.path).toBe(
      "/repo/.asem/sessions/s_0001/zellij-layout.kdl",
    );
    expect(runner.writes[0]!.contents).toContain('pane command="bash"');
    expect(runner.writes[0]!.contents).toContain(
      'args "/repo/.asem/sessions/s_0001/launch.sh"',
    );
    // The only run step is the real zellij create; no printf echo runs just to
    // re-capture a value already known from base vars.
    expect(commandsOf(runner)).toHaveLength(1);
    expect(commandsOf(runner)[0]).toContain(
      "zellij attach --create-background 's_0001'",
    );
    expect(commandsOf(runner)[0]).toContain("--default-cwd '/repo'");
    expect(commandsOf(runner)[0]).toContain("zellij-layout.kdl");
    expect(commandsOf(runner).some((c) => c.includes("printf"))).toBe(false);
    expect(runner.commands[0]!.cwd).toBe("/repo");
    expect(runner.commands[0]!.env).toEqual({ AS_X: "1" });
    expect(refs).toEqual({ zellij_session_name: "s_0001" });
  });

  test("escapes cwd and launch script when writing the KDL layout", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner({ commands: [{}] });
    const result = await engine(runner).run(template.create, {
      cwd: '/repo "quoted"',
      variables: {
        ...BASE_VARS,
        cwd: '/repo "quoted"',
        cwd_kdl: '/repo \\"quoted\\"',
        launch_script: '/repo/path with "quote"/launch.sh',
        launch_script_kdl: '/repo/path with \\"quote\\"/launch.sh',
      },
    });

    expect(result.ok).toBe(true);
    expect(runner.writes[0]!.contents).toContain('cwd="/repo \\"quoted\\""');
    expect(runner.writes[0]!.contents).toContain(
      'args "/repo/path with \\"quote\\"/launch.sh"',
    );
  });

  test("run_in_pane is a no-op because the default layout starts launch.sh", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.run_in_pane, runner, {
      zellij_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toEqual([]);
    expect(runner.events).toEqual([]);
  });

  test("send writes the message then Enter", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.send, runner, {
      zellij_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toEqual([
      "ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" zellij --session 's_0001' action write-chars --pane-id terminal_0 'hi; there'",
      "ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" zellij --session 's_0001' action write --pane-id terminal_0 13",
    ]);
  });

  test("attach attaches to the zellij session", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.attach, runner, {
      zellij_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toEqual([
      'mkdir -p "${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" && ZELLIJ_SOCKET_DIR="${ZELLIJ_SOCKET_DIR:-/tmp/zellij}" zellij attach \'s_0001\'',
    ]);
  });

  test("close kills and deletes the zellij session", async () => {
    const template = muxTemplate("zellij");
    const runner = new FakeTemplateRunner();
    await runWithRefsOnly(template.close, runner, {
      zellij_session_name: "s_0001",
    });
    expect(commandsOf(runner)).toEqual([
      "ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" zellij kill-session 's_0001'",
      "ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" zellij delete-session 's_0001'",
    ]);
  });
});

// --- cross-cutting: same template addresses the pane it created ------------

describe("builtin mux: a created pane is addressed by the same template", () => {
  const cases = [
    {
      name: "herdr",
      createScript: [
        { stdout: "asem" },
        {
          stdout: JSON.stringify({
            result: {
              workspace: { workspace_id: "w" },
              root_pane: { pane_id: "w-7" },
              tab: { tab_id: "w:9" },
            },
          }),
        },
      ],
      addressedBy: "w",
    },
    {
      // tmux/zellij address later sequences by the declared session-name ref
      // (derived from the session id), not a captured value.
      name: "tmux",
      createScript: [{ stdout: "%12\n" }],
      addressedBy: "s_0001",
    },
    {
      name: "zellij",
      createScript: [{}],
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
        await runWithRefsOnly(sequence, runner, refs);
        const joined = commandsOf(runner).join("\n");
        expect(joined).toContain(c.addressedBy);
      }
    });
  }
});
