import { describe, expect, test } from "bun:test";
import {
  type ConfirmPrompt,
  type InitWizardPrompts,
  PromptCancelledError,
  runInitWizard,
  type SelectPrompt,
  type TextPrompt,
} from "../src/init-wizard.ts";

class FakePrompts implements InitWizardPrompts {
  readonly inputs: TextPrompt[] = [];
  readonly selects: SelectPrompt<string>[] = [];
  readonly confirms: ConfirmPrompt[] = [];
  inputAnswers: string[] = [];
  selectAnswers: string[] = [];
  confirmAnswers: boolean[] = [];
  cancelOn: "input" | "select" | "confirm" | null = null;

  async input(prompt: TextPrompt): Promise<string> {
    this.inputs.push(prompt);
    if (this.cancelOn === "input") throw new PromptCancelledError();
    return this.inputAnswers.shift() ?? prompt.defaultValue ?? "";
  }

  async select<T extends string>(prompt: SelectPrompt<T>): Promise<T> {
    this.selects.push(prompt as SelectPrompt<string>);
    if (this.cancelOn === "select") throw new PromptCancelledError();
    return (this.selectAnswers.shift() ?? prompt.choices[0]!.value) as T;
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    this.confirms.push(prompt);
    if (this.cancelOn === "confirm") throw new PromptCancelledError();
    return this.confirmAnswers.shift() ?? prompt.defaultValue;
  }
}

describe("runInitWizard", () => {
  test("skips prompts for values already provided by flags", async () => {
    const prompts = new FakePrompts();
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({
      cwd: "/repo/asem",
      configPath: "/repo/asem/.asem.yaml",
      prompts,
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
    });

    expect(result).toEqual({
      kind: "selected",
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
    });
    expect(prompts.inputs).toHaveLength(0);
    expect(prompts.selects).toHaveLength(0);
    expect(prompts.confirms).toHaveLength(1);
    expect(prompts.confirms[0]!.message).toContain("Workspace: ws_1");
    expect(prompts.confirms[0]!.message).toContain("Agent:     pi");
    expect(prompts.confirms[0]!.message).toContain("Mux:       tmux");
  });

  test("proposes the worktree directory name as the workspace default", async () => {
    const prompts = new FakePrompts();
    prompts.selectAnswers = ["pi", "tmux"];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({
      cwd: "/repo/asem",
      configPath: "/repo/asem/.asem.yaml",
      prompts,
    });

    expect(result).toMatchObject({
      kind: "selected",
      workspaceId: "asem",
      agent: "pi",
      mux: "tmux",
    });
    expect(prompts.inputs[0]).toMatchObject({
      message: "Workspace id",
      defaultValue: "asem",
    });
  });

  test("returns cancelled when final confirmation is declined", async () => {
    const prompts = new FakePrompts();
    prompts.confirmAnswers = [false];

    const result = await runInitWizard({
      cwd: "/repo/asem",
      configPath: "/repo/asem/.asem.yaml",
      prompts,
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
    });

    expect(result).toEqual({ kind: "cancelled" });
  });

  test("returns cancelled when a prompt is interrupted", async () => {
    const prompts = new FakePrompts();
    prompts.cancelOn = "select";

    const result = await runInitWizard({
      cwd: "/repo/asem",
      configPath: "/repo/asem/.asem.yaml",
      prompts,
      workspaceId: "ws_1",
    });

    expect(result).toEqual({ kind: "cancelled" });
  });
});
