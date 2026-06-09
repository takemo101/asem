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
}

export interface ConfirmPrompt {
  message: string;
  defaultValue: boolean;
}

export interface InitWizardPrompts {
  input(prompt: TextPrompt): Promise<string>;
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
  agent?: string;
  mux?: string;
}

export type InitWizardResult =
  | { kind: "selected"; workspaceId: string; agent: string; mux: string }
  | { kind: "cancelled" };

function defaultWorkspaceId(cwd: string): string {
  return basename(cwd) || "workspace";
}

function choices(names: string[]): SelectChoice<string>[] {
  return names.map((name) => ({ name, value: name }));
}

function summary(options: {
  workspaceId: string;
  agent: string;
  mux: string;
  configPath: string;
}): string {
  return [
    "Create asem config with:",
    `Workspace: ${options.workspaceId}`,
    `Agent:     ${options.agent} (template will be materialized)`,
    `Mux:       ${options.mux} (template will be materialized)`,
    `Config:    ${options.configPath}`,
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
    const agent =
      options.agent ??
      (await options.prompts.select({
        message: "Default Agent",
        choices: choices(builtinAgentNames()),
      }));
    const mux =
      options.mux ??
      (await options.prompts.select({
        message: "Default Multiplexer",
        choices: choices(builtinMuxNames()),
      }));

    const confirmed = await options.prompts.confirm({
      message: summary({
        workspaceId,
        agent,
        mux,
        configPath: options.configPath,
      }),
      defaultValue: true,
    });
    if (!confirmed) return { kind: "cancelled" };
    return { kind: "selected", workspaceId, agent, mux };
  } catch (error) {
    if (error instanceof PromptCancelledError) return { kind: "cancelled" };
    throw error;
  }
}
