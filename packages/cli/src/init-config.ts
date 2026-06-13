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
  type AgentTemplate,
  agentTemplateSchema,
  builtinAgentTemplates,
  builtinMuxTemplates,
  muxTemplateSchema,
} from "@asem/runtime";

/**
 * Materialize a parsed Agent Template into the minimal object written to
 * `.asem.yaml`, omitting default/empty fields so a generated config stays close
 * to what an author would hand-write. `paste_prompt: false` and every empty
 * sequence/hook array (`before_paste`, `before_agent`, `after_agent`) are
 * dropped; only fields that carry meaning are kept (MIK-030/MIK-034).
 */
function cleanAgentTemplate(template: AgentTemplate): Record<string, unknown> {
  const result: Record<string, unknown> = { command: template.command };
  if (template.paste_prompt) {
    result.paste_prompt = true;
  }
  if (template.before_paste.length > 0) {
    result.before_paste = template.before_paste;
  }
  if (template.before_agent.length > 0) {
    result.before_agent = template.before_agent;
  }
  if (template.after_agent.length > 0) {
    result.after_agent = template.after_agent;
  }
  return result;
}

export interface InitConfigSelection {
  workspaceId: string;
  agent: string;
  mux: string;
}

export type InitConfigResult =
  | { ok: true; value: Config }
  | { ok: false; error: OperationError };

export type InitTemplateValidationResult =
  | { ok: true }
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

export function validateInitAgentName(
  agent: string,
): InitTemplateValidationResult {
  return builtinAgentTemplates[agent] === undefined
    ? { ok: false, error: unknownTemplateError("agent", agent) }
    : { ok: true };
}

export function validateInitMuxName(mux: string): InitTemplateValidationResult {
  return builtinMuxTemplates[mux] === undefined
    ? { ok: false, error: unknownTemplateError("mux", mux) }
    : { ok: true };
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
    templates: { [selection.agent]: cleanAgentTemplate(agentTemplate.data) },
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
