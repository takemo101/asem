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
  type MuxTemplate,
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
  // model_flag must travel with the command's {{model_shell}} placeholder: a
  // materialized template carrying one without the other is invalid on reload
  // (MIK-040). Builtins that support a model always set both.
  if (template.model_flag !== undefined) {
    result.model_flag = template.model_flag;
  }
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

function cleanMuxTemplate(template: MuxTemplate): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (template.create.length > 0) {
    result.create = template.create;
  }
  if (template.run_in_pane.length > 0) {
    result.run_in_pane = template.run_in_pane;
  }
  if (template.send.length > 0) {
    result.send = template.send;
  }
  if (template.attach.length > 0) {
    result.attach = template.attach;
  }
  if (template.attach_command.length > 0) {
    result.attach_command = template.attach_command;
  }
  if (template.close.length > 0) {
    result.close = template.close;
  }
  if (Object.keys(template.refs).length > 0) {
    result.refs = template.refs;
  }
  return result;
}

export interface InitConfigSelection {
  workspaceId: string;
  /** Default Agent Template name; always included in the materialized map. */
  agent: string;
  /** Default Multiplexer Template name; always included in the materialized map. */
  mux: string;
  /**
   * Agent Templates to materialize (interactive multi-select). When omitted, only
   * `agent` is materialized, preserving non-interactive single-template behavior.
   */
  agents?: string[];
  /** Multiplexer Templates to materialize; see `agents`. */
  muxes?: string[];
}

/**
 * Resolve the Template names to materialize: dedupe and always include the
 * default. Unknown names are preserved (not filtered out) so the caller can
 * surface a validation error; emission order is applied separately.
 */
function wantedNames(
  selected: string[] | undefined,
  fallbackDefault: string,
): Set<string> {
  const wanted = new Set(selected ?? [fallbackDefault]);
  wanted.add(fallbackDefault);
  return wanted;
}

/**
 * Order materialized names by builtin-name ascending so generated `.asem.yaml`
 * output is deterministic regardless of prompt selection order.
 */
function orderByBuiltin(wanted: Set<string>, builtinOrder: string[]): string[] {
  return builtinOrder.filter((name) => wanted.has(name));
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

/** Materialize one parsed Agent Template into its `.asem.yaml` object, or error. */
function materializeAgentTemplate(
  name: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: OperationError } {
  const raw = builtinAgentTemplates[name];
  if (raw === undefined) {
    return { ok: false, error: unknownTemplateError("agent", name) };
  }
  const parsed = agentTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid builtin agent template", {
        name,
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    };
  }
  return { ok: true, value: cleanAgentTemplate(parsed.data) };
}

/** Materialize one parsed Mux Template into its `.asem.yaml` object, or error. */
function materializeMuxTemplate(
  name: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: OperationError } {
  const raw = builtinMuxTemplates[name];
  if (raw === undefined) {
    return { ok: false, error: unknownTemplateError("mux", name) };
  }
  const parsed = muxTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid builtin mux template", {
        name,
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    };
  }
  return { ok: true, value: cleanMuxTemplate(parsed.data) };
}

/** Materialize selected builtin Agent/Mux Templates into a Config object. */
export function materializeInitConfig(
  selection: InitConfigSelection,
): InitConfigResult {
  const agentWanted = wantedNames(selection.agents, selection.agent);
  const muxWanted = wantedNames(selection.muxes, selection.mux);

  // Validate every wanted name (including unknowns) before ordering, so unknown
  // selections surface a validation error instead of being silently dropped.
  const agentTemplates: Record<string, unknown> = {};
  for (const name of orderByBuiltin(agentWanted, builtinAgentNames())) {
    agentWanted.delete(name);
    const result = materializeAgentTemplate(name);
    if (!result.ok) return { ok: false, error: result.error };
    agentTemplates[name] = result.value;
  }
  for (const name of agentWanted) {
    return { ok: false, error: unknownTemplateError("agent", name) };
  }

  const muxTemplates: Record<string, unknown> = {};
  for (const name of orderByBuiltin(muxWanted, builtinMuxNames())) {
    muxWanted.delete(name);
    const result = materializeMuxTemplate(name);
    if (!result.ok) return { ok: false, error: result.error };
    muxTemplates[name] = result.value;
  }
  for (const name of muxWanted) {
    return { ok: false, error: unknownTemplateError("mux", name) };
  }

  const agent: AgentConfig = {
    default: selection.agent,
    templates: agentTemplates,
  };
  const mux: MuxConfig = {
    default: selection.mux,
    templates: muxTemplates,
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
