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
  TemplateRunner,
} from "@asem/core";

export const PACKAGE_NAME = "@asem/runtime";

export type { CommandRunner, TemplateRegistry, TemplateRunner };

// Template schemas & types
export {
  agentTemplateSchema,
  captureSourceSchema,
  captureSpecSchema,
  commandSequenceSchema,
  muxTemplateSchema,
  onErrorPolicySchema,
  promptDeliverySchema,
  runStepSchema,
  sequenceStepSchema,
  waitMsStepSchema,
  writeFileStepSchema,
  type AgentTemplate,
  type CaptureSource,
  type CaptureSpec,
  type CommandSequence,
  type MuxTemplate,
  type OnErrorPolicy,
  type PromptDelivery,
  type RunStep,
  type SequenceStep,
  type WaitMsStep,
  type WriteFileStep,
} from "./template/schema.ts";

// Interpolation
export {
  interpolate,
  interpolateOptional,
  interpolateValues,
  MissingVariableError,
  type InterpolationVars,
} from "./template/interpolate.ts";

// Template registry
export {
  createTemplateRegistry,
  type TemplateRegistryOptions,
  type TypedTemplateRegistry,
} from "./template/registry.ts";
export {
  builtinAgentTemplates,
  builtinMuxTemplates,
} from "./template/builtin.ts";

// Capture
export {
  applyCapture,
  evaluateJsonPath,
  type CaptureOutcome,
} from "./engine/capture.ts";

// Sequence engine
export {
  SequenceEngine,
  type SequenceContext,
  type SequenceEngineDeps,
  type SequenceRunResult,
} from "./engine/sequence.ts";

// Runtime error signals
export { SequenceTimeoutError } from "./errors.ts";

// Redaction
export {
  createMemoryLogger,
  createRedactor,
  noopRedactor,
  redactFields,
  withRedaction,
  type LogEntry,
} from "./redact/redact.ts";

// Test harness: virtual time & fake runner
export { VirtualClock } from "./testing/virtual-clock.ts";
export {
  FakeTemplateRunner,
  type CommandTrace,
  type FakeCommandScript,
  type FakeRunnerOptions,
  type FakeWriteScript,
  type TraceEvent,
  type WriteTrace,
} from "./testing/fake-runner.ts";
