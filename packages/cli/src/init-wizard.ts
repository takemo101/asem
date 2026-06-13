/** Init Wizard flow for `asem init --interactive`. */
import { basename } from "node:path";
import { builtinAgentNames, builtinMuxNames } from "./init-config.ts";

export interface TextPrompt {
  message: string;
  defaultValue?: string;
}

export interface SelectChoice<T extends string> {
  name: string;
  value: T;
}

export interface SelectPrompt<T extends string> {
  message: string;
  choices: SelectChoice<T>[];
  /** Initially-highlighted choice value. */
  defaultValue?: T;
}

export interface CheckboxChoice<T extends string> {
  name: string;
  value: T;
  /** Initially checked. */
  checked?: boolean;
  /** Locked: shown but cannot be toggled. `string` renders as the lock reason. */
  disabled?: boolean | string;
}

export interface CheckboxPrompt<T extends string> {
  message: string;
  choices: CheckboxChoice<T>[];
  /** Require at least one selected choice. */
  required?: boolean;
}

export interface ConfirmPrompt {
  message: string;
  defaultValue: boolean;
}

export interface InitWizardPrompts {
  input(prompt: TextPrompt): Promise<string>;
  checkbox<T extends string>(prompt: CheckboxPrompt<T>): Promise<T[]>;
  select<T extends string>(prompt: SelectPrompt<T>): Promise<T>;
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
}

export class PromptCancelledError extends Error {
  constructor() {
    super("prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

export interface InitWizardOptions {
  cwd: string;
  configPath: string;
  prompts: InitWizardPrompts;
  workspaceId?: string;
  /** Fixed default Agent Template from `--agent`, if provided. */
  agent?: string;
  /** Fixed default Multiplexer Template from `--mux`, if provided. */
  mux?: string;
}

export type InitWizardResult =
  | {
      kind: "selected";
      workspaceId: string;
      defaultAgent: string;
      defaultMux: string;
      selectedAgents: string[];
      selectedMuxes: string[];
    }
  | { kind: "cancelled" };

/** Existing builtin defaults used to pre-check the checkbox prompts. */
const DEFAULT_AGENT = "claude";
const DEFAULT_MUX = "herdr";

function defaultWorkspaceId(cwd: string): string {
  return basename(cwd) || "workspace";
}

function dedupeOrdered(names: string[], order: string[]): string[] {
  const wanted = new Set(names);
  return order.filter((name) => wanted.has(name));
}

/**
 * Run one Template category: show a checkbox of all builtins, then resolve the
 * default. Returns the materialized Template names (ascending builtin order) and
 * the chosen default.
 *
 * Rules (MIK-032):
 * - When `fixed` is set (`--agent`/`--mux`), it is the locked, pre-checked
 *   default; the default select is skipped and `fixed` is always included.
 * - Otherwise the existing default is pre-checked; a single selection skips the
 *   default select, and a multi-selection prompts for the default highlighting
 *   the existing default when present, else the first ascending builtin.
 */
async function resolveCategory(options: {
  prompts: InitWizardPrompts;
  label: string;
  builtinNames: string[];
  existingDefault: string;
  fixed: string | undefined;
}): Promise<{ selected: string[]; default: string }> {
  const { prompts, label, builtinNames, existingDefault, fixed } = options;

  const checkboxChoices: CheckboxChoice<string>[] = builtinNames.map((name) => {
    const isFixed = fixed !== undefined && name === fixed;
    return {
      name: isFixed ? `${name} (default)` : name,
      value: name,
      checked: fixed !== undefined ? isFixed : name === existingDefault,
      ...(isFixed ? { disabled: true } : {}),
    };
  });

  const chosen = await prompts.checkbox({
    message: `${label} Templates (select one or more)`,
    choices: checkboxChoices,
    required: true,
  });

  // The fixed default is locked, so it is always part of the materialized set
  // even if a prompt adapter omits disabled choices from its result.
  const merged = fixed !== undefined ? [fixed, ...chosen] : chosen;
  const selected = dedupeOrdered(merged, builtinNames);

  if (fixed !== undefined) return { selected, default: fixed };
  const first = selected[0] ?? existingDefault;
  if (selected.length === 1) return { selected, default: first };

  const highlight = selected.includes(existingDefault)
    ? existingDefault
    : first;
  const chosenDefault = await prompts.select({
    message: `Default ${label} Template`,
    choices: selected.map((name) => ({ name, value: name })),
    defaultValue: highlight,
  });
  return { selected, default: chosenDefault };
}

function summary(options: {
  workspaceId: string;
  defaultAgent: string;
  selectedAgents: string[];
  defaultMux: string;
  selectedMuxes: string[];
  configPath: string;
}): string {
  return [
    "Create asem config with:",
    `Workspace: ${options.workspaceId}`,
    `Default Agent Template: ${options.defaultAgent}`,
    `Agent Templates: ${options.selectedAgents.join(", ")}`,
    `Default Multiplexer Template: ${options.defaultMux}`,
    `Multiplexer Templates: ${options.selectedMuxes.join(", ")}`,
    `Config: ${options.configPath}`,
  ].join("\n");
}

/** Run the init-only setup wizard, returning selected config or cancellation. */
export async function runInitWizard(
  options: InitWizardOptions,
): Promise<InitWizardResult> {
  try {
    const workspaceId =
      options.workspaceId ??
      (await options.prompts.input({
        message: "Workspace id",
        defaultValue: defaultWorkspaceId(options.cwd),
      }));

    const agentCategory = await resolveCategory({
      prompts: options.prompts,
      label: "Agent",
      builtinNames: builtinAgentNames(),
      existingDefault: DEFAULT_AGENT,
      fixed: options.agent,
    });

    const muxCategory = await resolveCategory({
      prompts: options.prompts,
      label: "Multiplexer",
      builtinNames: builtinMuxNames(),
      existingDefault: DEFAULT_MUX,
      fixed: options.mux,
    });

    const confirmed = await options.prompts.confirm({
      message: summary({
        workspaceId,
        defaultAgent: agentCategory.default,
        selectedAgents: agentCategory.selected,
        defaultMux: muxCategory.default,
        selectedMuxes: muxCategory.selected,
        configPath: options.configPath,
      }),
      defaultValue: true,
    });
    if (!confirmed) return { kind: "cancelled" };
    return {
      kind: "selected",
      workspaceId,
      defaultAgent: agentCategory.default,
      defaultMux: muxCategory.default,
      selectedAgents: agentCategory.selected,
      selectedMuxes: muxCategory.selected,
    };
  } catch (error) {
    if (error instanceof PromptCancelledError) return { kind: "cancelled" };
    throw error;
  }
}
