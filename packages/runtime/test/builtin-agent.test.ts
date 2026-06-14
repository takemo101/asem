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
 * Builtin agent template tests (MIK-008, MIK-030).
 *
 * These exercise the builtin agent templates (claude / codex / pi / gemini /
 * agy / opencode) and prompt-aware Agent command rendering entirely through the
 * typed registry, {@link renderAgentCommand}, and the {@link FakeTemplateRunner}.
 * No real agent CLI is required (implementation principle 4) — the optional
 * real-CLI `--help` checks live in `builtin-agent.integration.test.ts` and skip
 * by default.
 *
 * Post-MIK-030, an Agent Template owns only the agent **command** (a shell
 * command string that may carry the prompt placeholders `{{prompt_shell}}` /
 * `{{prompt_path_shell}}`) plus the optional `paste_prompt` flag and its
 * `before_paste` sequence. It must not own multiplexer lifecycle: for the paste
 * flow, the prompt is pasted by the mux `send` sequence the operation runs,
 * which the paste-flow test below composes explicitly.
 *
 * ## Verified CLI flag assumptions (macOS, 2026-06-06, from each `--help`)
 *
 * - claude   `claude [prompt]`        positional prompt, interactive default
 * - codex    `codex [PROMPT]`         positional prompt, interactive default
 * - pi       `pi [messages...]`       positional message, interactive default
 * - gemini   `gemini [query..]`       positional query "interactive by default"
 * - agy      `agy --prompt-interactive <text>` interactive initial prompt → `agy -i`
 * - opencode `opencode` (TUI)         no initial-prompt arg → paste_prompt + before_paste delay
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
      // Parsed into the typed shape: command + paste flag + sequence/hook arrays.
      expect(typeof template?.command).toBe("string");
      expect(typeof template?.paste_prompt).toBe("boolean");
      expect(Array.isArray(template?.before_paste)).toBe(true);
      expect(Array.isArray(template?.before_agent)).toBe(true);
      expect(Array.isArray(template?.after_agent)).toBe(true);
    }
  });

  test("acceptance: agy or gemini is present", () => {
    const names = createTemplateRegistry().agentTemplateNames();
    expect(names.includes("agy") || names.includes("gemini")).toBe(true);
  });

  test("each builtin declares a non-empty command and re-parses cleanly", () => {
    const registry = createTemplateRegistry();
    for (const name of registry.agentTemplateNames()) {
      const template = registry.getAgentTemplate(name)!;
      // Re-parsing the resolved value proves it satisfies the schema fully.
      expect(() => agentTemplateSchema.parse(template)).not.toThrow();
      expect(template.command.length).toBeGreaterThan(0);
    }
  });

  test("builtin commands carry the prompt placeholder, except the paste builtin", () => {
    expect(agentTemplate("claude").command).toBe(
      "claude {{model_shell}} {{prompt_shell}}",
    );
    expect(agentTemplate("codex").command).toBe(
      "codex {{model_shell}} {{prompt_shell}}",
    );
    expect(agentTemplate("pi").command).toBe(
      "pi {{model_shell}} {{prompt_shell}}",
    );
    expect(agentTemplate("gemini").command).toBe(
      "gemini {{model_shell}} {{prompt_shell}}",
    );
    expect(agentTemplate("agy").command).toBe("agy -i {{prompt_shell}}");
    // opencode starts bare and pastes the prompt instead, but still supports
    // model selection through its startup command.
    expect(agentTemplate("opencode").command).toBe("opencode {{model_shell}}");
    expect(agentTemplate("opencode").paste_prompt).toBe(true);
  });

  test("model-supported builtins declare model_flag; agy does not", () => {
    for (const name of ["claude", "codex", "pi", "gemini", "opencode"]) {
      expect(agentTemplate(name).model_flag).toBe("--model");
    }
    expect(agentTemplate("agy").model_flag).toBeUndefined();
  });

  test("only the paste builtin sets paste_prompt and a before_paste sequence", () => {
    expect(agentTemplate("opencode").before_paste).toEqual([
      { type: "wait_ms", ms: 750 },
    ]);
    for (const name of ["claude", "codex", "pi", "gemini", "agy"]) {
      expect(agentTemplate(name).paste_prompt).toBe(false);
      expect(agentTemplate(name).before_paste).toEqual([]);
    }
  });

  test("no builtin declares before_agent / after_agent hooks by default", () => {
    for (const name of ["claude", "codex", "pi", "gemini", "agy", "opencode"]) {
      expect(agentTemplate(name).before_agent).toEqual([]);
      expect(agentTemplate(name).after_agent).toEqual([]);
    }
  });
});

// --- command rendering per builtin ----------------------------------------

describe("builtin agent templates: rendered launch command", () => {
  test("placeholder builtins read prompt.md via $(cat ...) with a shell-escaped path", () => {
    // {{prompt_shell}} keeps the prompt body out of the literal command (and
    // argv), so only the escaped file path appears — long/multiline prompts
    // never leak into the visible command. With no model, {{model_shell}}
    // collapses to empty, leaving a harmless double space.
    expect(
      renderAgentCommand(agentTemplate("claude"), { promptPath: PROMPT_PATH }),
    ).toBe(`claude  "$(cat ${PROMPT_SHELL})"`);
    expect(
      renderAgentCommand(agentTemplate("codex"), { promptPath: PROMPT_PATH }),
    ).toBe(`codex  "$(cat ${PROMPT_SHELL})"`);
    expect(
      renderAgentCommand(agentTemplate("pi"), { promptPath: PROMPT_PATH }),
    ).toBe(`pi  "$(cat ${PROMPT_SHELL})"`);
    expect(
      renderAgentCommand(agentTemplate("gemini"), { promptPath: PROMPT_PATH }),
    ).toBe(`gemini  "$(cat ${PROMPT_SHELL})"`);
    // agy is model-unsupported, so its command carries no {{model_shell}}.
    expect(
      renderAgentCommand(agentTemplate("agy"), { promptPath: PROMPT_PATH }),
    ).toBe(`agy -i "$(cat ${PROMPT_SHELL})"`);
  });

  test("model-supported builtins render the model flag when a model is given", () => {
    expect(
      renderAgentCommand(agentTemplate("claude"), {
        promptPath: PROMPT_PATH,
        model: "sonnet",
      }),
    ).toBe(`claude '--model' 'sonnet' "$(cat ${PROMPT_SHELL})"`);
  });

  test("paste builtin renders the bare command (prompt pasted later)", () => {
    // No prompt token on the command line — the prompt is delivered by the mux
    // `send` sequence after the agent starts. With no model the {{model_shell}}
    // collapses to empty, leaving a trailing space.
    expect(
      renderAgentCommand(agentTemplate("opencode"), {
        promptPath: PROMPT_PATH,
      }),
    ).toBe("opencode ");
    expect(
      renderAgentCommand(agentTemplate("opencode"), {
        promptPath: PROMPT_PATH,
        model: "grok",
      }),
    ).toBe("opencode '--model' 'grok'");
  });
});

// --- model placeholder rendering & schema ----------------------------------

describe("Agent command model placeholder", () => {
  test("{{model_shell}} renders model_flag + shell-escaped model when specified", () => {
    const template = agentTemplateSchema.parse({
      command: "agent {{model_shell}} {{prompt_shell}}",
      model_flag: "--model",
    });
    expect(
      renderAgentCommand(template, {
        promptPath: PROMPT_PATH,
        model: "sonnet",
      }),
    ).toBe(`agent '--model' 'sonnet' "$(cat ${PROMPT_SHELL})"`);
  });

  test("{{model_shell}} renders empty when model is omitted", () => {
    const template = agentTemplateSchema.parse({
      command: "agent {{model_shell}} {{prompt_shell}}",
      model_flag: "--model",
    });
    expect(renderAgentCommand(template, { promptPath: PROMPT_PATH })).toBe(
      `agent  "$(cat ${PROMPT_SHELL})"`,
    );
    // An explicit null model behaves like an omitted one.
    expect(
      renderAgentCommand(template, { promptPath: PROMPT_PATH, model: null }),
    ).toBe(`agent  "$(cat ${PROMPT_SHELL})"`);
  });

  test("{{model_shell}} shell-escapes both the flag and the model value", () => {
    const template = agentTemplateSchema.parse({
      command: "agent {{model_shell}}",
      model_flag: "-m",
    });
    expect(
      renderAgentCommand(template, {
        promptPath: PROMPT_PATH,
        model: "claude's model",
      }),
    ).toBe("agent '-m' 'claude'\\''s model'");
  });

  test("{{model_shell}} escapes a metacharacter-bearing flag so it cannot break out", () => {
    // A flag carrying shell metacharacters is template-authored config, but the
    // spec contract still shell-escapes it (defence in depth), so it cannot be
    // interpreted by the shell — it stays a single literal argument.
    const template = agentTemplateSchema.parse({
      command: "agent {{model_shell}}",
      model_flag: "--model; rm -rf /",
    });
    expect(
      renderAgentCommand(template, {
        promptPath: PROMPT_PATH,
        model: "sonnet",
      }),
    ).toBe("agent '--model; rm -rf /' 'sonnet'");
  });

  test("rejects {{model_shell}} without model_flag", () => {
    expect(
      agentTemplateSchema.safeParse({ command: "agent {{model_shell}}" })
        .success,
    ).toBe(false);
  });

  test("rejects model_flag without a {{model_shell}} placeholder", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "agent {{prompt_shell}}",
        model_flag: "--model",
      }).success,
    ).toBe(false);
  });

  test("paste_prompt may coexist with {{model_shell}}", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "opencode {{model_shell}}",
        model_flag: "--model",
        paste_prompt: true,
      }).success,
    ).toBe(true);
  });

  test("an empty model_flag is rejected", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "agent {{model_shell}}",
        model_flag: "",
      }).success,
    ).toBe(false);
  });
});

// --- prompt placeholder rendering ------------------------------------------

describe("Agent command prompt placeholders", () => {
  const cases: Array<{ name: string; command: string; expected: string }> = [
    {
      name: "{{prompt_shell}} as a positional argument",
      command: "agent {{prompt_shell}}",
      expected: `agent "$(cat ${PROMPT_SHELL})"`,
    },
    {
      name: "{{prompt_shell}} before trailing fixed args",
      command: "agent --prompt {{prompt_shell}} --continue",
      expected: `agent --prompt "$(cat ${PROMPT_SHELL})" --continue`,
    },
    {
      name: "{{prompt_path_shell}} as a prompt-file argument",
      command: "agent --prompt-file {{prompt_path_shell}}",
      expected: `agent --prompt-file ${PROMPT_SHELL}`,
    },
    {
      name: "{{prompt_path_shell}} via stdin redirection",
      command: "agent < {{prompt_path_shell}}",
      expected: `agent < ${PROMPT_SHELL}`,
    },
    {
      name: "a placeholder with surrounding whitespace",
      command: "agent {{ prompt_shell }}",
      expected: `agent "$(cat ${PROMPT_SHELL})"`,
    },
  ];

  for (const c of cases) {
    test(`renders ${c.name}`, () => {
      const template = agentTemplateSchema.parse({ command: c.command });
      expect(renderAgentCommand(template, { promptPath: PROMPT_PATH })).toBe(
        c.expected,
      );
    });
  }

  test("a command with no placeholder and no paste_prompt renders verbatim", () => {
    // The prompt is still written to prompt.md by create_session, but the
    // command does not reference it (ADR 0005).
    const template = agentTemplateSchema.parse({ command: "agent --resume" });
    expect(renderAgentCommand(template, { promptPath: PROMPT_PATH })).toBe(
      "agent --resume",
    );
  });

  test("every placeholder keeps the prompt path shell-escaped where it appears", () => {
    for (const command of [
      "agent {{prompt_shell}}",
      "agent {{prompt_path_shell}}",
      "agent < {{prompt_path_shell}}",
    ]) {
      const template = agentTemplateSchema.parse({ command });
      const rendered = renderAgentCommand(template, {
        promptPath: PROMPT_PATH,
      });
      expect(rendered).toContain(PROMPT_SHELL);
      // The raw, unescaped path (with a bare space) must never appear.
      expect(rendered).not.toContain(" 1/prompt.md ");
    }
  });
});

// --- schema validation -----------------------------------------------------

describe("Agent template schema validation", () => {
  test("rejects the removed prompt_delivery field", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "claude",
        prompt_delivery: "arg",
      }).success,
    ).toBe(false);
  });

  test("rejects the removed after_start field", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "claude",
        after_start: [{ type: "wait_ms", ms: 100 }],
      }).success,
    ).toBe(false);
  });

  test("rejects an unknown {{...}} placeholder in command", () => {
    const result = agentTemplateSchema.safeParse({
      command: "agent {{prompt}} {{bogus}}",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("bogus");
    }
  });

  test("rejects malformed placeholders the bare-word regex would miss", () => {
    // A `\w+`-only matcher silently ignores these and would drop the prompt; a
    // balanced `{{...}}` matcher rejects every non-allowed inner text.
    for (const command of [
      "agent {{prompt-shell}}", // hyphen is not a word char
      "agent {{ prompt_shell | quote }}", // filter syntax
      "agent {{}}", // empty
      "agent {{ }}", // whitespace only
      "agent {{prompt_shell }} {{other.thing}}", // dotted name
    ]) {
      const result = agentTemplateSchema.safeParse({ command });
      expect(result.success).toBe(false);
    }
  });

  test("accepts the allowed placeholders even with surrounding whitespace", () => {
    expect(
      agentTemplateSchema.safeParse({ command: "agent {{ prompt_shell }}" })
        .success,
    ).toBe(true);
    expect(
      agentTemplateSchema.safeParse({
        command: "agent {{prompt_path_shell}}",
      }).success,
    ).toBe(true);
  });

  test("rejects paste_prompt combined with a prompt placeholder in command", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "agent {{prompt_shell}}",
        paste_prompt: true,
      }).success,
    ).toBe(false);
  });

  test("rejects before_paste when paste_prompt is not true", () => {
    expect(
      agentTemplateSchema.safeParse({
        command: "agent {{prompt_shell}}",
        before_paste: [{ type: "wait_ms", ms: 500 }],
      }).success,
    ).toBe(false);
  });

  test("accepts paste_prompt with a bare command and before_paste", () => {
    const result = agentTemplateSchema.safeParse({
      command: "opencode",
      paste_prompt: true,
      before_paste: [{ type: "wait_ms", ms: 750 }],
    });
    expect(result.success).toBe(true);
  });

  test("defaults paste_prompt to false and the sequences/hooks to empty arrays", () => {
    const template = agentTemplateSchema.parse({ command: "claude" });
    expect(template.paste_prompt).toBe(false);
    expect(template.before_paste).toEqual([]);
    expect(template.before_agent).toEqual([]);
    expect(template.after_agent).toEqual([]);
  });

  test("accepts before_agent / after_agent literal command lines", () => {
    const template = agentTemplateSchema.parse({
      command: "agent {{prompt_shell}}",
      before_agent: ["echo prepping"],
      after_agent: ['echo done "$AS_AGENT_EXIT_CODE"'],
    });
    expect(template.before_agent).toEqual(["echo prepping"]);
    expect(template.after_agent).toEqual(['echo done "$AS_AGENT_EXIT_CODE"']);
  });
});

// --- token safety ----------------------------------------------------------

describe("agent command rendering: token safety", () => {
  test("the rendered command never contains token material", () => {
    // The agent command only ever references prompt.md; the Session token is
    // injected via env by the launch script, never on the command line
    // (implementation principle 8).
    for (const command of [
      "agent {{prompt_shell}}",
      "agent {{prompt_path_shell}}",
      "agent --resume",
    ]) {
      const template = agentTemplateSchema.parse({ command });
      const rendered = renderAgentCommand(template, {
        promptPath: PROMPT_PATH,
      });
      expect(rendered).not.toContain("AS_SESSION_TOKEN");
      expect(rendered).not.toContain("tok_");
    }
  });
});

// --- paste flow: before_paste then mux send --------------------------------

describe("paste flow: before_paste precedes a mux send after the agent starts", () => {
  const commandsOf = (runner: FakeTemplateRunner): string[] =>
    runner.commands.map((c) => c.command);

  test("opencode: start bare, run before_paste, then mux-send the prompt", async () => {
    const template = agentTemplate("opencode");
    expect(template.paste_prompt).toBe(true);

    // 1) The launch command starts the agent with no prompt argument.
    const launchCommand = renderAgentCommand(template, {
      promptPath: PROMPT_PATH,
    });
    expect(launchCommand).toBe("opencode ");

    // 2) The operation would start that command in the pane (run_in_pane). We
    //    model the post-start steps here: the agent template's `before_paste`
    //    (a boot delay it owns), then the mux `send` sequence (which the mux
    //    template owns — the agent template never embeds mux commands).
    const muxSend = createTemplateRegistry().getMuxTemplate("herdr")!.send;

    const runner = new FakeTemplateRunner();
    const engine = new SequenceEngine({ runner });

    // before_paste runs first (the agent has just started)...
    const beforePaste: CommandSequence = template.before_paste;
    const beforeResult = await engine.run(beforePaste, {
      cwd: "/repo",
      variables: { pane_id: "w-3" },
    });
    expect(beforeResult.ok).toBe(true);
    // wait_ms is not a shell command, so nothing was run on the multiplexer yet.
    expect(runner.commands).toHaveLength(0);

    // ...then the mux `send` sequence pastes the prompt into the same pane.
    const sendResult = await engine.run(muxSend, {
      cwd: "/repo",
      variables: {
        pane_id: "w-3",
        herdr_session: "asem",
        message: "do the work",
      },
    });
    expect(sendResult.ok).toBe(true);

    const muxCommands = commandsOf(runner);
    expect(muxCommands).toEqual([
      "herdr --session 'asem' wait agent-status 'w-3' --status idle --timeout 30000",
      "herdr --session 'asem' pane run 'w-3' 'do the work'",
    ]);
  });

  test("before_paste declares a boot delay so the paste lands after the TUI is ready", () => {
    const beforePaste = agentTemplate("opencode").before_paste;
    expect(beforePaste).toEqual([{ type: "wait_ms", ms: 750 }]);
    for (const step of beforePaste) {
      expect(step.type).not.toBe("run");
    }
  });
});
