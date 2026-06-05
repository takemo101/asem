import type {
  Logger,
  OperationError,
  OperationErrorCode,
  OperationResult,
  Redactor,
  TemplateRunner,
} from "@asem/core";
import { err, ok, operationError } from "@asem/core";
import type {
  CommandSequence,
  RunStep,
  SequenceStep,
  WaitMsStep,
  WriteFileStep,
} from "../template/schema.ts";
import {
  interpolate,
  interpolateValues,
  MissingVariableError,
} from "../template/interpolate.ts";
import { applyCapture } from "./capture.ts";
import { SequenceTimeoutError } from "../errors.ts";
import { noopRedactor } from "../redact/redact.ts";

/**
 * Command sequence engine.
 *
 * Executes a parsed {@link CommandSequence} step by step against an injected
 * {@link TemplateRunner}. Command Sequences are startup/control procedures, not
 * workflows: steps run strictly in order, with no looping, branching, or
 * parallelism. The only error handling is the per-step `on_error` policy
 * (`fail` — default — or `ignore`); it can never express retry, rollback, or
 * conditional branching.
 *
 * Interpolation variables flow forward: each step is interpolated against the
 * initial variables plus everything captured by earlier steps. Failures are
 * returned as structured `@asem/core` operation errors with secrets redacted.
 */

export interface SequenceContext {
  /** Default working directory for `run` steps without their own `cwd`. */
  cwd?: string;
  /** Base environment merged under each `run` step's `env`. */
  env?: Record<string, string>;
  /** Default timeout applied to `run` steps without their own `timeout_ms`. */
  defaultTimeoutMs?: number;
  /** Initial interpolation variables (raw values; `_shell` is derived). */
  variables?: Record<string, string>;
}

export interface SequenceRunResult {
  /** Values captured by `capture` specs, keyed by variable name. */
  captures: Record<string, string>;
  /** Background handles returned by background `run` steps, in order. */
  backgroundHandles: string[];
}

export interface SequenceEngineDeps {
  runner: TemplateRunner;
  redactor?: Redactor;
  logger?: Logger;
}

type StepOutcome =
  | { ok: true; vars: Record<string, string>; backgroundHandles: string[] }
  | { ok: false; error: OperationError };

export class SequenceEngine {
  private readonly runner: TemplateRunner;
  private readonly redactor: Redactor;
  private readonly logger: Logger | undefined;

  constructor(deps: SequenceEngineDeps) {
    this.runner = deps.runner;
    this.redactor = deps.redactor ?? noopRedactor;
    this.logger = deps.logger;
  }

  async run(
    steps: CommandSequence,
    context: SequenceContext = {},
  ): Promise<OperationResult<SequenceRunResult>> {
    const vars: Record<string, string> = { ...(context.variables ?? {}) };
    const captures: Record<string, string> = {};
    const backgroundHandles: string[] = [];

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] as SequenceStep;
      const outcome = await this.executeStep(step, context, vars);

      if (!outcome.ok) {
        if (step.on_error === "ignore") {
          this.logger?.debug("sequence step failed; ignored per on_error", {
            stepIndex: index,
            type: step.type,
            code: outcome.error.code,
          });
          continue;
        }
        this.logger?.error("sequence step failed", {
          stepIndex: index,
          type: step.type,
          code: outcome.error.code,
          message: outcome.error.message,
        });
        return err(outcome.error);
      }

      for (const [name, value] of Object.entries(outcome.vars)) {
        vars[name] = value;
        captures[name] = value;
      }
      backgroundHandles.push(...outcome.backgroundHandles);
    }

    return ok({ captures, backgroundHandles });
  }

  private async executeStep(
    step: SequenceStep,
    context: SequenceContext,
    vars: Record<string, string>,
  ): Promise<StepOutcome> {
    switch (step.type) {
      case "run":
        return this.executeRun(step, context, vars);
      case "write_file":
        return this.executeWriteFile(step, vars);
      case "wait_ms":
        return this.executeWaitMs(step);
      default: {
        const exhaustive: never = step;
        throw new Error(
          `unknown sequence step: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  private async executeRun(
    step: RunStep,
    context: SequenceContext,
    vars: Record<string, string>,
  ): Promise<StepOutcome> {
    let command: string;
    let cwd: string | undefined;
    let env: Record<string, string> | undefined;
    try {
      command = interpolate(step.command, vars);
      cwd =
        step.cwd !== undefined ? interpolate(step.cwd, vars) : context.cwd;
      env = this.resolveEnv(context.env, step.env, vars);
    } catch (error) {
      return this.fail("sequence_step_failed", this.describe(error));
    }

    const timeoutMs = step.timeout_ms ?? context.defaultTimeoutMs;
    const background = step.background ?? false;

    const request = {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      background,
    };

    let result;
    try {
      result = await this.runner.run(request);
    } catch (error) {
      if (error instanceof SequenceTimeoutError) {
        return this.fail("timeout", error.message, {
          command,
          timeoutMs: error.timeoutMs,
        });
      }
      return this.fail("sequence_step_failed", this.describe(error), {
        command,
      });
    }

    if (result.exitCode !== 0) {
      return this.fail("sequence_step_failed", "command exited non-zero", {
        command,
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    }

    const newVars: Record<string, string> = {};
    if (step.capture) {
      for (const spec of step.capture) {
        const captured = applyCapture(spec, result.stdout, result.stderr);
        if (!captured.ok) {
          return this.fail("capture_failed", captured.reason, {
            name: spec.name,
          });
        }
        newVars[spec.name] = captured.value;
      }
    }

    const handles =
      background && result.backgroundHandle !== undefined
        ? [result.backgroundHandle]
        : [];
    return { ok: true, vars: newVars, backgroundHandles: handles };
  }

  private async executeWriteFile(
    step: WriteFileStep,
    vars: Record<string, string>,
  ): Promise<StepOutcome> {
    let path: string;
    let contents: string;
    try {
      path = interpolate(step.path, vars);
      contents = interpolate(step.contents, vars);
    } catch (error) {
      return this.fail("sequence_step_failed", this.describe(error));
    }
    try {
      await this.runner.writeFile(
        path,
        contents,
        step.mode !== undefined ? { mode: step.mode } : undefined,
      );
    } catch (error) {
      return this.fail("sequence_step_failed", this.describe(error), { path });
    }
    return { ok: true, vars: {}, backgroundHandles: [] };
  }

  private async executeWaitMs(step: WaitMsStep): Promise<StepOutcome> {
    try {
      await this.runner.wait(step.ms);
    } catch (error) {
      return this.fail("sequence_step_failed", this.describe(error));
    }
    return { ok: true, vars: {}, backgroundHandles: [] };
  }

  private resolveEnv(
    base: Record<string, string> | undefined,
    stepEnv: Record<string, string> | undefined,
    vars: Record<string, string>,
  ): Record<string, string> | undefined {
    if (base === undefined && stepEnv === undefined) {
      return undefined;
    }
    return {
      ...(base ?? {}),
      ...(stepEnv ? interpolateValues(stepEnv, vars) : {}),
    };
  }

  private describe(error: unknown): string {
    if (error instanceof MissingVariableError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /** Build a redacted structured error for a failed step. */
  private fail(
    code: OperationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): StepOutcome {
    const redactedMessage = this.redactor.redact(message);
    const redactedDetails =
      details !== undefined ? this.redactDetails(details) : undefined;
    return {
      ok: false,
      error: operationError(code, redactedMessage, redactedDetails),
    };
  }

  private redactDetails(
    details: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      out[key] =
        typeof value === "string" ? this.redactor.redact(value) : value;
    }
    return out;
  }
}
