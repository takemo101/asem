/**
 * Helpers for materializing selected builtin Templates into the initial
 * `.asem.yaml` config. This lives in the CLI surface because the choice is a
 * human/operator setup concern; `@asem/ops` receives already-built config data
 * and stays non-interactive.
 */
import {
  type AgentConfig,
  type Config,
  type MuxConfig,
  type OperationError,
  operationError,
} from "@asem/core";
import {
  agentTemplateSchema,
  builtinAgentTemplates,
  builtinMuxTemplates,
  muxTemplateSchema,
} from "@asem/runtime";

export interface InitConfigSelection {
  workspaceId: string;
  agent: string;
  mux: string;
}

export type InitConfigResult =
  | { ok: true; value: Config }
  | { ok: false; error: OperationError };

function knownNames(record: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(record).sort();
}

function unknownTemplateError(
  kind: "agent" | "mux",
  name: string,
): OperationError {
  const known =
    kind === "agent"
      ? knownNames(builtinAgentTemplates)
      : knownNames(builtinMuxTemplates);
  return operationError("invalid_input", `unknown ${kind} template: ${name}`, {
    name,
    known,
  });
}

/** Materialize selected builtin Agent/Mux Templates into a Config object. */
export function materializeInitConfig(
  selection: InitConfigSelection,
): InitConfigResult {
  const rawAgent = builtinAgentTemplates[selection.agent];
  if (rawAgent === undefined) {
    return { ok: false, error: unknownTemplateError("agent", selection.agent) };
  }
  const rawMux = builtinMuxTemplates[selection.mux];
  if (rawMux === undefined) {
    return { ok: false, error: unknownTemplateError("mux", selection.mux) };
  }

  const agentTemplate = agentTemplateSchema.safeParse(rawAgent);
  if (!agentTemplate.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid builtin agent template", {
        name: selection.agent,
        issues: agentTemplate.error.issues.map((issue) => issue.message),
      }),
    };
  }

  const muxTemplate = muxTemplateSchema.safeParse(rawMux);
  if (!muxTemplate.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid builtin mux template", {
        name: selection.mux,
        issues: muxTemplate.error.issues.map((issue) => issue.message),
      }),
    };
  }

  const agent: AgentConfig = {
    default: selection.agent,
    templates: { [selection.agent]: agentTemplate.data },
  };
  const mux: MuxConfig = {
    default: selection.mux,
    templates: { [selection.mux]: muxTemplate.data },
  };

  return {
    ok: true,
    value: {
      workspace: { id: selection.workspaceId },
      agent,
      mux,
    },
  };
}

export function builtinAgentNames(): string[] {
  return knownNames(builtinAgentTemplates);
}

export function builtinMuxNames(): string[] {
  return knownNames(builtinMuxTemplates);
}
