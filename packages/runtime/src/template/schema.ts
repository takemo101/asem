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
  })
  .strict();
export type MuxTemplate = z.infer<typeof muxTemplateSchema>;

/** How an agent template delivers the initial prompt. */
export const promptDeliverySchema = z.enum(["arg", "stdin", "file", "paste"]);
export type PromptDelivery = z.infer<typeof promptDeliverySchema>;

/** Agent template: the agent command plus prompt delivery mode. */
export const agentTemplateSchema = z
  .object({
    command: nonEmptyString,
    prompt_delivery: promptDeliverySchema,
    after_start: commandSequenceSchema.default([]),
  })
  .strict();
export type AgentTemplate = z.infer<typeof agentTemplateSchema>;
