import { describe, expect, test } from "bun:test";
import {
  type AgentTemplate,
  agentTemplateSchema,
  type CommandSequence,
  createTemplateRegistry,
  FakeTemplateRunner,
  renderAgentCommand,
  SequenceEngine,
} from "../src/index.ts";

/**
 * Builtin agent template tests (MIK-008).
 *
 * These exercise the builtin agent templates (claude / codex / pi / gemini /
 * agy / opencode) and the prompt-delivery command rendering entirely through the
 * typed registry, {@link renderAgentCommand}, and the {@link FakeTemplateRunner}.
 * No real agent CLI is required (implementation principle 4) — the optional
 * real-CLI `--help` checks live in `builtin-agent.integration.test.ts` and skip
 * by default.
 *
 * An agent template owns only the agent **command** and the initial **prompt
 * delivery mode** (plus an optional `after_start` for the paste flow). It must
 * not own multiplexer lifecycle: for `paste` delivery, the prompt is pasted by
 * the mux `send` sequence the operation runs, which the paste-flow test below
 * composes explicitly.
 *
 * ## Verified CLI flag assumptions (macOS, 2026-06-06, from each `--help`)
 *
 * - claude   `claude [prompt]`        positional prompt, interactive default → arg
 * - codex    `codex [PROMPT]`         positional prompt, interactive default → arg
 * - pi       `pi [messages...]`       positional message, interactive default → arg
 * - gemini   `gemini [query..]`       positional query "interactive by default" → arg
 * - agy      `agy --prompt-interactive <text>` interactive initial prompt → command `agy -i`, arg
 * - opencode `opencode` (TUI)         no initial-prompt arg → paste + after_start boot delay
 *
 * The interactive builtins use `arg` because a redirected stdin/file would close
 * the agent's TTY input; `stdin` and `file` remain engine-supported and are
 * covered by the delivery-mode rendering tests using documented templates.
 */

/** Path that contains a space + shell metachar to prove `_shell` escaping. */
const PROMPT_PATH = "/repo/.asem/sessions/s 1/prompt.md";
/** Its expected single-quoted shell form. */
const PROMPT_SHELL = "'/repo/.asem/sessions/s 1/prompt.md'";

function agentTemplate(name: string): AgentTemplate {
  const template = createTemplateRegistry().getAgentTemplate(name);
  expect(template).toBeDefined();
  return template as AgentTemplate;
}

// --- builtin set & shape ---------------------------------------------------

describe("builtin agent templates: set & shape", () => {
  test("every required builtin resolves through the typed path", () => {
    const registry = createTemplateRegistry();
    for (const name of ["claude", "codex", "pi", "gemini", "agy", "opencode"]) {
      const template = registry.getAgentTemplate(name);
      expect(template).toBeDefined();
      // Parsed into the typed shape: command + delivery + after_start array.
      expect(typeof template?.command).toBe("string");
      expect(Array.isArray(template?.after_start)).toBe(true);
    }
  });

  test("acceptance: agy or gemini is present", () => {
    const names = createTemplateRegistry().agentTemplateNames();
    expect(names.includes("agy") || names.includes("gemini")).toBe(true);
  });

  test("each builtin declares command and a valid prompt_delivery", () => {
    const registry = createTemplateRegistry();
    for (const name of registry.agentTemplateNames()) {
      const template = registry.getAgentTemplate(name)!;
      // Re-parsing the resolved value proves it satisfies the schema fully.
      expect(() => agentTemplateSchema.parse(template)).not.toThrow();
      expect(template.command.length).toBeGreaterThan(0);
      expect(["arg", "stdin", "file", "paste"]).toContain(
        template.prompt_delivery,
      );
    }
  });

  test("builtin delivery-mode assignments are exactly as documented", () => {
    expect(agentTemplate("claude").prompt_delivery).toBe("arg");
    expect(agentTemplate("codex").prompt_delivery).toBe("arg");
    expect(agentTemplate("pi").prompt_delivery).toBe("arg");
    expect(agentTemplate("gemini").prompt_delivery).toBe("arg");
    expect(agentTemplate("agy").prompt_delivery).toBe("arg");
    expect(agentTemplate("opencode").prompt_delivery).toBe("paste");
  });

  test("agy bakes the interactive-prompt flag into the command", () => {
    // The verified flag (`--prompt-interactive`/`-i`) lives in `command`, so arg
    // delivery appends the prompt as the flag's value rather than as a bare
    // positional the CLI would reject.
    expect(agentTemplate("agy").command).toBe("agy -i");
  });

  test("only the paste builtin declares an after_start sequence", () => {
    expect(agentTemplate("opencode").after_start).toEqual([
      { type: "wait_ms", ms: 750 },
    ]);
    for (const name of ["claude", "codex", "pi", "gemini", "agy"]) {
      expect(agentTemplate(name).after_start).toEqual([]);
    }
  });
});

// --- command rendering per builtin ----------------------------------------

describe("builtin agent templates: rendered launch command", () => {
  test("arg builtins read prompt.md via $(cat ...) with a shell-escaped path", () => {
    // $(cat ...) keeps the prompt body out of the literal command (and argv),
    // so only the escaped file path appears — long/multiline prompts never leak
    // into the visible command.
    expect(renderAgentCommand(agentTemplate("claude"), PROMPT_PATH)).toBe(
      `claude "$(cat ${PROMPT_SHELL})"`,
    );
    expect(renderAgentCommand(agentTemplate("codex"), PROMPT_PATH)).toBe(
      `codex "$(cat ${PROMPT_SHELL})"`,
    );
    expect(renderAgentCommand(agentTemplate("pi"), PROMPT_PATH)).toBe(
      `pi "$(cat ${PROMPT_SHELL})"`,
    );
    expect(renderAgentCommand(agentTemplate("gemini"), PROMPT_PATH)).toBe(
      `gemini "$(cat ${PROMPT_SHELL})"`,
    );
    expect(renderAgentCommand(agentTemplate("agy"), PROMPT_PATH)).toBe(
      `agy -i "$(cat ${PROMPT_SHELL})"`,
    );
  });

  test("paste builtin renders the bare command (prompt pasted later)", () => {
    // No prompt token on the command line — the prompt is delivered by the mux
    // `send` sequence after the agent starts.
    expect(renderAgentCommand(agentTemplate("opencode"), PROMPT_PATH)).toBe(
      "opencode",
    );
  });
});

// --- all four delivery modes represented ----------------------------------

describe("prompt delivery modes: arg / stdin / file / paste", () => {
  // `stdin` and `file` have no interactive builtin, so they are represented here
  // with documented templates. This keeps all four modes covered by tests even
  // though not every builtin uses every mode (MIK-008 acceptance).
  const cases: Array<{
    delivery: AgentTemplate["prompt_delivery"];
    command: string;
    expected: string;
  }> = [
    {
      delivery: "arg",
      command: "claude",
      expected: `claude "$(cat ${PROMPT_SHELL})"`,
    },
    {
      delivery: "stdin",
      command: "someagent",
      expected: `someagent < ${PROMPT_SHELL}`,
    },
    {
      delivery: "file",
      command: "someagent",
      expected: `someagent ${PROMPT_SHELL}`,
    },
    { delivery: "paste", command: "opencode", expected: "opencode" },
  ];

  for (const c of cases) {
    test(`${c.delivery} delivery renders as documented`, () => {
      const template = agentTemplateSchema.parse({
        command: c.command,
        prompt_delivery: c.delivery,
      });
      expect(renderAgentCommand(template, PROMPT_PATH)).toBe(c.expected);
    });
  }

  test("every delivery mode keeps the prompt path shell-escaped where it appears", () => {
    // arg/stdin/file all reference the path; each must escape it (the path here
    // contains a space). paste references no path at all.
    for (const delivery of ["arg", "stdin", "file"] as const) {
      const template = agentTemplateSchema.parse({
        command: "agent",
        prompt_delivery: delivery,
      });
      expect(renderAgentCommand(template, PROMPT_PATH)).toContain(PROMPT_SHELL);
      // The raw, unescaped path (with a bare space) must never appear.
      expect(renderAgentCommand(template, PROMPT_PATH)).not.toContain(
        " 1/prompt.md ",
      );
    }
  });
});

// --- token safety ----------------------------------------------------------

describe("agent command rendering: token safety", () => {
  test("the rendered command never contains token material", () => {
    // The agent command only ever references prompt.md; the Session token is
    // injected via env by the launch script, never on the command line
    // (implementation principle 8). Even if a token-looking string were the
    // prompt path, the renderer only emits the path, not any token env value.
    for (const delivery of ["arg", "stdin", "file", "paste"] as const) {
      const template = agentTemplateSchema.parse({
        command: "agent",
        prompt_delivery: delivery,
      });
      const rendered = renderAgentCommand(template, PROMPT_PATH);
      expect(rendered).not.toContain("AS_SESSION_TOKEN");
      expect(rendered).not.toContain("tok_");
    }
  });
});

// --- paste flow: after_start then mux send --------------------------------

describe("paste flow: after_start triggers a mux send after the agent starts", () => {
  const commandsOf = (runner: FakeTemplateRunner): string[] =>
    runner.commands.map((c) => c.command);

  test("opencode: start bare, run after_start, then mux-send the prompt", async () => {
    const template = agentTemplate("opencode");
    expect(template.prompt_delivery).toBe("paste");

    // 1) The launch command starts the agent with no prompt argument.
    const launchCommand = renderAgentCommand(template, PROMPT_PATH);
    expect(launchCommand).toBe("opencode");

    // 2) The operation would start that command in the pane (run_in_pane). We
    //    model the post-start steps here: the agent template's `after_start`
    //    (a boot delay it owns), then the mux `send` sequence (which the mux
    //    template owns — the agent template never embeds mux commands).
    const muxSend = createTemplateRegistry().getMuxTemplate("herdr")!.send;

    const runner = new FakeTemplateRunner();
    const engine = new SequenceEngine({ runner });

    // after_start runs first (the agent has just started)...
    const afterStart: CommandSequence = template.after_start;
    const afterResult = await engine.run(afterStart, {
      cwd: "/repo",
      variables: { pane_id: "w-3" },
    });
    expect(afterResult.ok).toBe(true);
    // wait_ms is not a shell command, so nothing was run on the multiplexer yet.
    expect(runner.commands).toHaveLength(0);

    // ...then the mux `send` sequence pastes the prompt into the same pane.
    const sendResult = await engine.run(muxSend, {
      cwd: "/repo",
      variables: {
        pane_id: "w-3",
        herdr_workspace_id: "workspace-1",
        herdr_label: "s_0001",
        message: "do the work",
      },
    });
    expect(sendResult.ok).toBe(true);

    // The paste lands as input then is submitted — after the agent started.
    const muxCommands = commandsOf(runner);
    expect(muxCommands).toHaveLength(2);
    expect(muxCommands[0]).toContain(
      '&& herdr pane send-text "$pane_id" \'do the work\'',
    );
    expect(muxCommands[1]).toContain(
      '&& herdr pane send-keys "$pane_id" Enter',
    );
  });

  test("after_start declares a boot delay so the paste lands after the TUI is ready", () => {
    // The delay is the agent template's only contribution to the paste flow; it
    // does not (and must not) contain mux commands.
    const afterStart = agentTemplate("opencode").after_start;
    expect(afterStart).toEqual([{ type: "wait_ms", ms: 750 }]);
    for (const step of afterStart) {
      expect(step.type).not.toBe("run");
    }
  });
});
