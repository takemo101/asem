/**
 * `@asem/runtime` — template registry, template interpolation, command
 * sequence execution, capture handling, and the fake runner contract.
 *
 * Builds on `@asem/core` contracts. It does not redefine domain types and uses
 * the `@asem/core` `shellEscape` primitive for all shell escaping rather than a
 * local implementation. Command Sequences are startup/control procedures, not
 * workflows: no loops, conditionals, parallelism, retries, or rollback.
 */
import type {
  CommandRunner,
  TemplateRegistry,
  TemplateRegistryFactory,
  TemplateRunner,
} from "@asem/core";

export const PACKAGE_NAME = "@asem/runtime";

// Capture
export {
  applyCapture,
  type CaptureOutcome,
  evaluateJsonPath,
} from "./engine/capture.ts";
// Sequence engine
export {
  type SequenceContext,
  SequenceEngine,
  type SequenceEngineDeps,
  type SequenceRunResult,
} from "./engine/sequence.ts";
// Runtime error signals
export { SequenceTimeoutError } from "./errors.ts";
// Redaction
export {
  createMemoryLogger,
  createRedactor,
  type LogEntry,
  noopRedactor,
  redactFields,
  withRedaction,
} from "./redact/redact.ts";
export { renderAgentCommand } from "./template/agent-command.ts";
export { renderAttachHint } from "./template/attach-hint.ts";
export {
  builtinAgentTemplates,
  builtinMuxTemplates,
} from "./template/builtin.ts";
// Interpolation
export {
  type InterpolationVars,
  interpolate,
  interpolateOptional,
  interpolateValues,
  MissingVariableError,
} from "./template/interpolate.ts";
// Template registry
export {
  createTemplateRegistry,
  createTemplateRegistryFactory,
  type TemplateRegistryOptions,
  type TypedTemplateRegistry,
} from "./template/registry.ts";
// Template schemas & types
export {
  type AgentTemplate,
  agentTemplateSchema,
  type CaptureSource,
  type CaptureSpec,
  type CommandSequence,
  captureSourceSchema,
  captureSpecSchema,
  commandSequenceSchema,
  type MuxTemplate,
  muxTemplateSchema,
  type OnErrorPolicy,
  onErrorPolicySchema,
  type PromptDelivery,
  promptDeliverySchema,
  type RunStep,
  runStepSchema,
  type SequenceStep,
  sequenceStepSchema,
  type WaitMsStep,
  type WriteFileStep,
  waitMsStepSchema,
  writeFileStepSchema,
} from "./template/schema.ts";
export {
  type CommandTrace,
  type FakeCommandScript,
  type FakeRunnerOptions,
  FakeTemplateRunner,
  type FakeWriteScript,
  type TraceEvent,
  type WriteTrace,
} from "./testing/fake-runner.ts";

// Test harness: virtual time & fake runner
export { VirtualClock } from "./testing/virtual-clock.ts";
export type {
  CommandRunner,
  TemplateRegistry,
  TemplateRegistryFactory,
  TemplateRunner,
};
