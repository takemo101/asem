/** Concrete Init Wizard prompt adapter backed by `@inquirer/prompts`. */
import {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from "@inquirer/prompts";
import {
  type CheckboxPrompt,
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

  checkbox<T extends string>(prompt: CheckboxPrompt<T>): Promise<T[]> {
    return mapPromptExit(() =>
      inquirerCheckbox({
        message: prompt.message,
        choices: prompt.choices.map((choice) => ({
          name: choice.name,
          value: choice.value,
          ...(choice.checked !== undefined ? { checked: choice.checked } : {}),
          ...(choice.disabled !== undefined
            ? { disabled: choice.disabled }
            : {}),
        })),
        ...(prompt.required !== undefined ? { required: prompt.required } : {}),
      }),
    );
  }

  select<T extends string>(prompt: SelectPrompt<T>): Promise<T> {
    return mapPromptExit(() =>
      inquirerSelect({
        message: prompt.message,
        choices: prompt.choices,
        ...(prompt.defaultValue !== undefined
          ? { default: prompt.defaultValue }
          : {}),
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
