import { describe, expect, test } from "bun:test";
import { type AgentTemplate, createTemplateRegistry } from "../src/index.ts";

/**
 * Optional real-CLI flag checks for the builtin agent templates (MIK-008).
 *
 * These are intentionally **off by default**: the default `bun run test` must
 * never require a real agent CLI to be installed (testability rules;
 * implementation principle 4). They run only when explicitly opted in with
 * `ASEM_AGENT_INTEGRATION=1`, and each per-agent block additionally skips when
 * its binary is unavailable.
 *
 * They are strictly **non-destructive and never launch an agent**: they only run
 * `--help` (no model call, no session, no prompt) and assert that the flag the
 * builtin template relies on still exists. This is the executable record of the
 * "verified CLI flag assumptions" documented in `builtin-agent.test.ts` and in
 * `builtin.ts`; if a CLI changes its prompt flag, this surfaces it without ever
 * spending tokens or spawning an interactive session.
 *
 * Default coverage of command construction and delivery modes lives entirely in
 * the fake-runner tests in `builtin-agent.test.ts`.
 */

const INTEGRATION = process.env.ASEM_AGENT_INTEGRATION === "1";

function has(binary: string): boolean {
  return Bun.which(binary) !== null;
}

/** Run `<binary> --help` non-destructively and return combined output. */
function help(binary: string): string {
  const out = Bun.spawnSync([binary, "--help"]);
  return `${out.stdout?.toString() ?? ""}\n${out.stderr?.toString() ?? ""}`;
}

function builtin(name: string): AgentTemplate {
  return createTemplateRegistry().getAgentTemplate(name) as AgentTemplate;
}

describe.skipIf(!INTEGRATION)("builtin agent integration (opt-in)", () => {
  // The binary each builtin invokes is the first word of its `command`.
  const binaryOf = (name: string): string =>
    builtin(name).command.split(/\s+/)[0] as string;

  describe.skipIf(!has("claude"))("claude", () => {
    test("--help documents the positional prompt the command seeds", () => {
      expect(builtin("claude").command).toContain("{{prompt_shell}}");
      expect(help(binaryOf("claude")).toLowerCase()).toContain("prompt");
    });
  });

  describe.skipIf(!has("codex"))("codex", () => {
    test("--help documents the positional PROMPT the command seeds", () => {
      expect(builtin("codex").command).toContain("{{prompt_shell}}");
      expect(help(binaryOf("codex")).toUpperCase()).toContain("PROMPT");
    });
  });

  describe.skipIf(!has("pi"))("pi", () => {
    test("--help documents positional messages the command seeds", () => {
      expect(builtin("pi").command).toContain("{{prompt_shell}}");
      expect(help(binaryOf("pi")).toLowerCase()).toContain("messages");
    });
  });

  describe.skipIf(!has("gemini"))("gemini", () => {
    test("--help documents the positional query the command seeds", () => {
      expect(builtin("gemini").command).toContain("{{prompt_shell}}");
      expect(help(binaryOf("gemini")).toLowerCase()).toContain("interactive");
    });
  });

  describe.skipIf(!has("agy"))("agy", () => {
    test("--help documents the --prompt-interactive flag the command bakes in", () => {
      const template = builtin("agy");
      expect(template.command).toBe("agy -i {{prompt_shell}}");
      expect(help("agy")).toContain("prompt-interactive");
    });
  });

  describe.skipIf(!has("opencode"))("opencode", () => {
    test("the TUI default has no initial-prompt arg, so paste is used", () => {
      expect(builtin("opencode").paste_prompt).toBe(true);
      // `run` is the non-interactive message form we deliberately avoid; the
      // default `opencode` invocation starts the interactive TUI.
      expect(help("opencode").toLowerCase()).toContain("tui");
    });
  });
});
