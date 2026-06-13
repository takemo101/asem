import { nonEmptyString } from "@asem/core";
import { z } from "zod";

/**
 * Typed shapes for command sequence templates.
 *
 * Template definitions are external input (builtin literals and project-local
 * `.asem.yaml` records). Per implementation principle 1, the runtime parses
 * them into typed values instead of merely checking them, so every later layer
 * works against a validated {@link CommandSequence}.
 *
 * Command Sequences are startup/control procedures, not workflows: there are no
 * loops, conditionals, parallelism, retries, or rollback DSL. The only error
 * policy is the narrow {@link onErrorPolicySchema} (`fail` or `ignore`).
 */

/**
 * Narrow per-step error policy. Deliberately limited to two terminal choices so
 * `on_error` cannot grow into branching, retry, rollback, or workflow control.
 */
export const onErrorPolicySchema = z.enum(["fail", "ignore"]);
export type OnErrorPolicy = z.infer<typeof onErrorPolicySchema>;

/** Where a capture reads from. */
export const captureSourceSchema = z.enum(["stdout", "stderr"]);
export type CaptureSource = z.infer<typeof captureSourceSchema>;

/**
 * A single capture extracts one value from a `run` step's output into a named
 * interpolation variable. Capture is either regex-based or JSONPath-based; the
 * two are mutually exclusive.
 */
export const captureSpecSchema = z.union([
  z
    .object({
      name: nonEmptyString,
      /** Output stream to read from; defaults to stdout. */
      source: captureSourceSchema.optional(),
      regex: nonEmptyString,
      /** Capture group index; defaults to 0 (the whole match). */
      group: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      name: nonEmptyString,
      source: captureSourceSchema.optional(),
      jsonpath: nonEmptyString,
    })
    .strict(),
]);
export type CaptureSpec = z.infer<typeof captureSpecSchema>;

/** `run`: execute a shell command, optionally backgrounded, with captures. */
export const runStepSchema = z
  .object({
    type: z.literal("run"),
    command: nonEmptyString,
    cwd: nonEmptyString.optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeout_ms: z.number().int().positive().optional(),
    background: z.boolean().optional(),
    capture: z.array(captureSpecSchema).optional(),
    on_error: onErrorPolicySchema.optional(),
  })
  .strict();
export type RunStep = z.infer<typeof runStepSchema>;

/** `write_file`: write interpolated contents to a Session-local file. */
export const writeFileStepSchema = z
  .object({
    type: z.literal("write_file"),
    path: nonEmptyString,
    contents: z.string(),
    mode: z.number().int().nonnegative().optional(),
    on_error: onErrorPolicySchema.optional(),
  })
  .strict();
export type WriteFileStep = z.infer<typeof writeFileStepSchema>;

/** `wait_ms`: pause for a fixed number of (virtual) milliseconds. */
export const waitMsStepSchema = z
  .object({
    type: z.literal("wait_ms"),
    ms: z.number().int().nonnegative(),
    on_error: onErrorPolicySchema.optional(),
  })
  .strict();
export type WaitMsStep = z.infer<typeof waitMsStepSchema>;

export const sequenceStepSchema = z.discriminatedUnion("type", [
  runStepSchema,
  writeFileStepSchema,
  waitMsStepSchema,
]);
export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const commandSequenceSchema = z.array(sequenceStepSchema);
export type CommandSequence = z.infer<typeof commandSequenceSchema>;

/**
 * Mux template: the five command sequences a multiplexer integration exposes.
 * Each defaults to an empty sequence so partial templates parse cleanly.
 */
export const attachCommandTemplateSchema = z.array(nonEmptyString).default([]);
export type AttachCommandTemplate = z.infer<typeof attachCommandTemplateSchema>;

export const muxTemplateSchema = z
  .object({
    create: commandSequenceSchema.default([]),
    run_in_pane: commandSequenceSchema.default([]),
    send: commandSequenceSchema.default([]),
    attach: commandSequenceSchema.default([]),
    attach_command: attachCommandTemplateSchema,
    close: commandSequenceSchema.default([]),
    /**
     * Declared mux refs: each value is an interpolation template evaluated
     * against the `create_session` base variables and merged into the
     * Session's mux ref. A `create` capture with the same name wins — the
     * capture carries the live coordinate, the ref only a derivable one. This
     * removes the need for capture-only `printf` steps when a ref (e.g. a
     * session name derived from the Session id) is already known up front.
     */
    refs: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type MuxTemplate = z.infer<typeof muxTemplateSchema>;

/**
 * Prompt placeholders an Agent `command` may carry (ADR 0005). Both keep the
 * prompt body out of the literal launch script — `prompt_shell` expands to a
 * `$(cat …)` snippet, `prompt_path_shell` to the shell-escaped `prompt.md` path.
 * Any other `{{…}}` placeholder is invalid Agent Template configuration.
 */
export const AGENT_PROMPT_PLACEHOLDERS = [
  "prompt_shell",
  "prompt_path_shell",
] as const;

/**
 * Matches any `{{ … }}` placeholder; the capture group is the raw inner text.
 * Deliberately broad (not `\w+`) so malformed names like `prompt-shell`,
 * `prompt_shell | quote`, or an empty `{{}}` are still detected and rejected
 * rather than silently ignored (which would drop the prompt at run time).
 */
const PLACEHOLDER_RE = /\{\{([^}]*)\}\}/g;

/**
 * Inner text of every `{{…}}` placeholder in a command string, trimmed, in
 * order. The text is returned as-is (e.g. `prompt-shell`, `` for `{{}}`) so the
 * caller decides which names are valid.
 */
export function agentCommandPlaceholders(command: string): string[] {
  return [...command.matchAll(PLACEHOLDER_RE)].map((match) =>
    (match[1] as string).trim(),
  );
}

/**
 * Agent template: the agent command plus optional paste delivery and launch
 * hooks (ADR 0005, MIK-030/MIK-034).
 *
 * - `command` is a shell command string that may carry the prompt placeholders
 *   `{{prompt_shell}}` / `{{prompt_path_shell}}`. Unknown placeholders are
 *   rejected so a typo cannot silently drop the prompt.
 * - `paste_prompt: true` starts the Agent bare and lets the mux `send` sequence
 *   paste the prompt; it is mutually exclusive with prompt placeholders.
 * - `before_paste` runs after the Agent starts and before the paste; it is only
 *   valid when `paste_prompt: true`.
 * - `before_agent` / `after_agent` are literal shell command lines inserted into
 *   the generated `launch.sh` around the Agent process (MIK-034). They are not
 *   `{{…}}`-interpolated; hooks read launch env vars instead.
 */
export const agentTemplateSchema = z
  .object({
    command: nonEmptyString,
    paste_prompt: z.boolean().default(false),
    before_paste: commandSequenceSchema.default([]),
    before_agent: z.array(nonEmptyString).default([]),
    after_agent: z.array(nonEmptyString).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed = new Set<string>(AGENT_PROMPT_PLACEHOLDERS);
    const placeholders = agentCommandPlaceholders(value.command);
    for (const name of placeholders) {
      if (!allowed.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message: `unknown Agent command placeholder {{${name}}}`,
        });
      }
    }
    const hasPromptPlaceholder = placeholders.some((name) => allowed.has(name));
    if (value.paste_prompt && hasPromptPlaceholder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paste_prompt"],
        message:
          "paste_prompt is mutually exclusive with prompt placeholders in command",
      });
    }
    if (value.before_paste.length > 0 && !value.paste_prompt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["before_paste"],
        message: "before_paste is only valid when paste_prompt is true",
      });
    }
  });
export type AgentTemplate = z.infer<typeof agentTemplateSchema>;
