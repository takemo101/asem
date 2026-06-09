/** Concrete Init Wizard prompt adapter backed by `@inquirer/prompts`. */
import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from "@inquirer/prompts";
import {
  type ConfirmPrompt,
  type InitWizardPrompts,
  PromptCancelledError,
  type SelectPrompt,
  type TextPrompt,
} from "./init-wizard.ts";

function isPromptExit(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ExitPromptError" || error.name === "AbortPromptError";
}

async function mapPromptExit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isPromptExit(error)) throw new PromptCancelledError();
    throw error;
  }
}

export class InquirerInitWizardPrompts implements InitWizardPrompts {
  input(prompt: TextPrompt): Promise<string> {
    return mapPromptExit(() =>
      inquirerInput({
        message: prompt.message,
        ...(prompt.defaultValue !== undefined
          ? { default: prompt.defaultValue }
          : {}),
      }),
    );
  }

  select<T extends string>(prompt: SelectPrompt<T>): Promise<T> {
    return mapPromptExit(() =>
      inquirerSelect({
        message: prompt.message,
        choices: prompt.choices,
      }),
    );
  }

  confirm(prompt: ConfirmPrompt): Promise<boolean> {
    return mapPromptExit(() =>
      inquirerConfirm({
        message: prompt.message,
        default: prompt.defaultValue,
      }),
    );
  }
}
