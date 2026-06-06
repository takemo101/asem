/**
 * Agent command rendering — turn an {@link AgentTemplate} plus the Session's
 * `prompt.md` path into the single shell line that the launch script runs to
 * start the agent and deliver its initial prompt.
 *
 * This lives in `@asem/runtime` because agent command + prompt delivery mode is
 * agent-template semantics (architecture overview: "Agent Templates own agent
 * command and prompt delivery mode"). It must NOT own multiplexer lifecycle or
 * Session outcome interpretation; the actual paste, for `paste` delivery, is
 * performed later by the mux `send` sequence the operation runs, not here.
 *
 * Token safety (implementation principle 8): the rendered line never contains
 * the raw Session token. The token reaches the agent only through env exported
 * by the launch script (`create_session` owns that env injection). The only
 * value this renderer interpolates is the `prompt.md` path, always passed
 * through the centralized `@asem/core` {@link shellEscape} primitive (principle
 * 9) so a path with spaces or shell metacharacters cannot break out.
 *
 * `prompt.md` itself is always written by `create_session` regardless of
 * delivery mode, so it remains the audit/debug source of the prompt even when
 * the prompt is delivered by `stdin`, `file`, or `paste` rather than inlined.
 */
import { shellEscape } from "@asem/core";
import type { AgentTemplate } from "./schema.ts";

/**
 * Render the agent invocation line for the launch script per delivery mode.
 *
 * The `command` field carries the agent binary plus any fixed flags (for
 * example `agy -i`); the delivery mode decides how `prompt.md` is appended:
 *
 * - `arg`   — `<command> "$(cat <prompt>)"`: the prompt is read at run time and
 *   passed as a positional argument. Using `$(cat …)` keeps the prompt body out
 *   of the literal command string (and out of shell history / process argv as a
 *   static string), so long or multiline prompts do not leak into the visible
 *   command; the file path is the only interpolated value.
 * - `stdin` — `<command> < <prompt>`: the prompt file is piped on stdin.
 * - `file`  — `<command> <prompt>`: the prompt file path is passed as an
 *   argument for CLIs that accept a prompt file directly.
 * - `paste` — `<command>`: the agent starts with no prompt; the prompt is pasted
 *   afterwards by the mux `send` sequence (see {@link AgentTemplate.after_start}).
 */
export function renderAgentCommand(
  template: AgentTemplate,
  promptPath: string,
): string {
  const promptShell = shellEscape(promptPath);
  switch (template.prompt_delivery) {
    case "arg":
      return `${template.command} "$(cat ${promptShell})"`;
    case "stdin":
      return `${template.command} < ${promptShell}`;
    case "file":
      return `${template.command} ${promptShell}`;
    case "paste":
      // The prompt is pasted later via the mux `send` sequence after the agent
      // starts; the launch script only starts the agent here.
      return template.command;
    default: {
      const exhaustive: never = template.prompt_delivery;
      throw new Error(`unknown prompt_delivery: ${String(exhaustive)}`);
    }
  }
}
