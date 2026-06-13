/**
 * Agent command rendering — turn an {@link AgentTemplate} plus the Session's
 * `prompt.md` path into the single shell line that the launch script runs to
 * start the agent and deliver its initial prompt.
 *
 * This lives in `@asem/runtime` because the agent command + prompt placeholders
 * are agent-template semantics (architecture overview: "Agent Templates own the
 * agent command and prompt delivery"). It must NOT own multiplexer lifecycle or
 * Session outcome interpretation; the actual paste, for `paste_prompt`, is
 * performed later by the mux `send` sequence the operation runs, not here.
 *
 * Token safety (implementation principle 8): the rendered line never contains
 * the raw Session token. The token reaches the agent only through env exported
 * by the launch script (`create_session` owns that env injection). The only
 * value this renderer interpolates is the `prompt.md` path, always passed
 * through the centralized `@asem/core` {@link shellEscape} primitive (principle
 * 9) so a path with spaces or shell metacharacters cannot break out.
 *
 * `prompt.md` itself is always written by `create_session`, so it remains the
 * audit/debug source of the prompt even when the command does not reference it
 * (a bare command, or `paste_prompt` delivery).
 */
import { shellEscape } from "@asem/core";
import type { AgentTemplate } from "./schema.ts";

/** Matches any `{{ … }}` placeholder; the capture group is the raw inner text. */
const PLACEHOLDER_RE = /\{\{([^}]*)\}\}/g;

/**
 * Render the agent invocation line for the launch script (ADR 0005).
 *
 * The `command` field carries the agent binary, fixed flags, and optionally the
 * prompt placeholders:
 *
 * - `{{prompt_shell}}` — expands to `"$(cat <escaped-prompt-path>)"`: the prompt
 *   is read at run time, keeping the body out of the literal command string
 *   (and out of shell history / process argv as a static string) so long or
 *   multiline prompts never leak into the visible command; the file path is the
 *   only interpolated value.
 * - `{{prompt_path_shell}}` — expands to the shell-escaped `prompt.md` path, for
 *   CLIs that take a prompt-file argument or for stdin redirection.
 *
 * When `paste_prompt` is set the command is returned verbatim (it carries no
 * prompt placeholders); the prompt is pasted afterwards by the mux `send`
 * sequence. A command with neither placeholder nor `paste_prompt` is also
 * returned verbatim — the prompt stays in `prompt.md` unread by the agent.
 *
 * The schema validates the placeholder set before this runs, so only the two
 * known placeholders can reach here.
 */
export function renderAgentCommand(
  template: AgentTemplate,
  promptPath: string,
): string {
  if (template.paste_prompt) {
    return template.command;
  }
  const escapedPath = shellEscape(promptPath);
  return template.command.replace(PLACEHOLDER_RE, (_match, inner: string) => {
    const name = inner.trim();
    switch (name) {
      case "prompt_shell":
        return `"$(cat ${escapedPath})"`;
      case "prompt_path_shell":
        return escapedPath;
      default:
        // Unreachable: agentTemplateSchema rejects unknown placeholders.
        throw new Error(`unknown Agent command placeholder {{${name}}}`);
    }
  });
}
