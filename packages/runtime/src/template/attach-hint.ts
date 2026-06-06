/**
 * Attach-hint rendering — turn a mux template's `attach` sequence plus a
 * Session's captured mux refs into a single human/operator attach command.
 *
 * This is the one shared place attach guidance is produced: `@asem/ops`
 * `get_session` calls it so the CLI and TUI surfaces render the *same* hint
 * instead of each re-deriving attach commands from raw mux coordinates
 * (architecture rule: surfaces must not duplicate semantic logic). Attach stays
 * human/TUI-only — this renders a string for a human to run; it never executes a
 * mux binary and is never projected as an MCP tool.
 *
 * The hint is best-effort guidance, not a runtime sequence:
 *
 * - only `run` steps contribute (a `write_file`/`wait_ms` step is not a
 *   copy-pasteable command, so it is skipped); the builtin mux attach sequences
 *   are all `run` steps;
 * - multiple commands are joined with ` && ` so a multi-step attach (e.g. tmux's
 *   select-window + select-pane + attach-session) is a single runnable line;
 * - commands interpolate through the same `_shell` escaping path as the live
 *   sequences (implementation principle 9), so the rendered line is shell-safe.
 *
 * When the template defines no attach commands, or the captured refs are missing
 * a variable the attach commands reference (e.g. a Session registered via
 * `init-session` with a partial mux ref), this returns `undefined` so the
 * surface falls back to safe manual guidance rather than emitting a broken
 * command.
 */
import {
  type InterpolationVars,
  interpolate,
  MissingVariableError,
} from "./interpolate.ts";
import type { CommandSequence } from "./schema.ts";

/**
 * Render the human attach command for a mux template's `attach` sequence, or
 * `undefined` when no usable hint can be produced (no `run` steps, or a
 * referenced variable is absent from `vars`).
 */
export function renderAttachHint(
  attach: CommandSequence,
  vars: InterpolationVars,
): string | undefined {
  const commands: string[] = [];
  try {
    for (const step of attach) {
      if (step.type !== "run") {
        continue;
      }
      commands.push(interpolate(step.command, vars));
    }
  } catch (error) {
    // A partial mux ref is an expected condition (not a defect): produce no
    // hint and let the surface fall back to manual guidance.
    if (error instanceof MissingVariableError) {
      return undefined;
    }
    throw error;
  }
  return commands.length === 0 ? undefined : commands.join(" && ");
}
