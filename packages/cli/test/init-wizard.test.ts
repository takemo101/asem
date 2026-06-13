import { describe, expect, test } from "bun:test";
import {
  type CheckboxPrompt,
  type ConfirmPrompt,
  type InitWizardPrompts,
  PromptCancelledError,
  runInitWizard,
  type SelectPrompt,
  type TextPrompt,
} from "../src/init-wizard.ts";

class FakePrompts implements InitWizardPrompts {
  readonly inputs: TextPrompt[] = [];
  readonly checkboxes: CheckboxPrompt<string>[] = [];
  readonly selects: SelectPrompt<string>[] = [];
  readonly confirms: ConfirmPrompt[] = [];
  inputAnswers: string[] = [];
  checkboxAnswers: string[][] = [];
  selectAnswers: string[] = [];
  confirmAnswers: boolean[] = [];
  cancelOn: "input" | "checkbox" | "select" | "confirm" | null = null;

  async input(prompt: TextPrompt): Promise<string> {
    this.inputs.push(prompt);
    if (this.cancelOn === "input") throw new PromptCancelledError();
    return this.inputAnswers.shift() ?? prompt.defaultValue ?? "";
  }

  async checkbox<T extends string>(prompt: CheckboxPrompt<T>): Promise<T[]> {
    this.checkboxes.push(prompt as CheckboxPrompt<string>);
    if (this.cancelOn === "checkbox") throw new PromptCancelledError();
    const answer = this.checkboxAnswers.shift();
    if (answer !== undefined) return answer as T[];
    // default: the initially-checked choices
    return prompt.choices
      .filter((choice) => choice.checked)
      .map((choice) => choice.value);
  }

  async select<T extends string>(prompt: SelectPrompt<T>): Promise<T> {
    this.selects.push(prompt as SelectPrompt<string>);
    if (this.cancelOn === "select") throw new PromptCancelledError();
    return (this.selectAnswers.shift() ??
      prompt.defaultValue ??
      prompt.choices[0]!.value) as T;
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    this.confirms.push(prompt);
    if (this.cancelOn === "confirm") throw new PromptCancelledError();
    return this.confirmAnswers.shift() ?? prompt.defaultValue;
  }
}

const BASE = {
  cwd: "/repo/asem",
  configPath: "/repo/asem/.asem.yaml",
} as const;

describe("runInitWizard", () => {
  test("no-flag interactive init starts with claude and herdr checked", async () => {
    const prompts = new FakePrompts();
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts });

    expect(result).toEqual({
      kind: "selected",
      workspaceId: "asem",
      defaultAgent: "claude",
      defaultMux: "herdr",
      selectedAgents: ["claude"],
      selectedMuxes: ["herdr"],
    });

    const [agentCheckbox, muxCheckbox] = prompts.checkboxes;
    expect(agentCheckbox!.message).toContain("Agent Templates");
    expect(agentCheckbox!.required).toBe(true);
    const checkedAgents = agentCheckbox!.choices
      .filter((c) => c.checked)
      .map((c) => c.value);
    expect(checkedAgents).toEqual(["claude"]);

    expect(muxCheckbox!.message).toContain("Multiplexer Templates");
    expect(muxCheckbox!.required).toBe(true);
    const checkedMuxes = muxCheckbox!.choices
      .filter((c) => c.checked)
      .map((c) => c.value);
    expect(checkedMuxes).toEqual(["herdr"]);

    // single selection in each category skips the default select prompt
    expect(prompts.selects).toHaveLength(0);
  });

  test("single selection skips the default select", async () => {
    const prompts = new FakePrompts();
    prompts.checkboxAnswers = [["pi"], ["tmux"]];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts });

    expect(result).toMatchObject({
      kind: "selected",
      defaultAgent: "pi",
      defaultMux: "tmux",
      selectedAgents: ["pi"],
      selectedMuxes: ["tmux"],
    });
    expect(prompts.selects).toHaveLength(0);
  });

  test("multiple selection prompts for the default from the selected set", async () => {
    const prompts = new FakePrompts();
    prompts.checkboxAnswers = [
      ["pi", "claude"],
      ["tmux", "herdr"],
    ];
    prompts.selectAnswers = ["pi", "tmux"];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts });

    expect(result).toMatchObject({
      kind: "selected",
      defaultAgent: "pi",
      defaultMux: "tmux",
      selectedAgents: ["claude", "pi"],
      selectedMuxes: ["herdr", "tmux"],
    });

    const [agentSelect, muxSelect] = prompts.selects;
    // default select chooses only from the selected set, in ascending order
    expect(agentSelect!.choices.map((c) => c.value)).toEqual(["claude", "pi"]);
    // existing default (claude) present -> highlighted initially
    expect(agentSelect!.defaultValue).toBe("claude");
    expect(muxSelect!.choices.map((c) => c.value)).toEqual(["herdr", "tmux"]);
    expect(muxSelect!.defaultValue).toBe("herdr");
  });

  test("highlights the first ascending template when no existing default selected", async () => {
    const prompts = new FakePrompts();
    prompts.checkboxAnswers = [
      ["pi", "codex"],
      ["tmux", "zellij"],
    ];
    prompts.selectAnswers = ["pi", "tmux"];
    prompts.confirmAnswers = [true];

    await runInitWizard({ ...BASE, prompts });

    const [agentSelect, muxSelect] = prompts.selects;
    // claude not selected -> highlight first ascending (codex)
    expect(agentSelect!.defaultValue).toBe("codex");
    // herdr not selected -> highlight first ascending (tmux)
    expect(muxSelect!.defaultValue).toBe("tmux");
  });

  test("fixed --agent default is checked+locked and skips the agent default select", async () => {
    const prompts = new FakePrompts();
    // user adds claude on top of the locked pi default
    prompts.checkboxAnswers = [["pi", "claude"], ["herdr"]];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts, agent: "pi" });

    expect(result).toMatchObject({
      kind: "selected",
      defaultAgent: "pi",
      selectedAgents: ["claude", "pi"],
      defaultMux: "herdr",
    });

    const agentCheckbox = prompts.checkboxes[0]!;
    const piChoice = agentCheckbox.choices.find((c) => c.value === "pi")!;
    expect(piChoice.checked).toBe(true);
    expect(piChoice.disabled).toBe(true);
    expect(piChoice.name).toBe("pi (default)");

    // agent default select skipped (fixed), but mux is single so no select either
    expect(prompts.selects).toHaveLength(0);
  });

  test("fixed --mux default is checked+locked and skips the mux default select", async () => {
    const prompts = new FakePrompts();
    // single Agent Template skips Agent default select; user adds herdr on top of
    // the locked tmux default.
    prompts.checkboxAnswers = [["pi"], ["tmux", "herdr"]];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts, mux: "tmux" });

    expect(result).toMatchObject({
      kind: "selected",
      defaultAgent: "pi",
      selectedAgents: ["pi"],
      defaultMux: "tmux",
      selectedMuxes: ["herdr", "tmux"],
    });

    const muxCheckbox = prompts.checkboxes[1]!;
    const tmuxChoice = muxCheckbox.choices.find((c) => c.value === "tmux")!;
    expect(tmuxChoice.checked).toBe(true);
    expect(tmuxChoice.disabled).toBe(true);
    expect(tmuxChoice.name).toBe("tmux (default)");

    // Agent has a single selected Template and mux default is fixed.
    expect(prompts.selects).toHaveLength(0);
  });

  test("fixed default is always materialized even if checkbox omits it", async () => {
    const prompts = new FakePrompts();
    // simulate a fake/odd checkbox result that drops the locked default
    prompts.checkboxAnswers = [["claude"], ["herdr"]];
    prompts.confirmAnswers = [true];

    const result = await runInitWizard({ ...BASE, prompts, agent: "pi" });

    expect(result).toMatchObject({
      kind: "selected",
      defaultAgent: "pi",
      selectedAgents: ["claude", "pi"],
    });
  });

  test("proposes the worktree directory name as the workspace default", async () => {
    const prompts = new FakePrompts();
    prompts.confirmAnswers = [true];

    await runInitWizard({ ...BASE, prompts });

    expect(prompts.inputs[0]).toMatchObject({
      message: "Workspace id",
      defaultValue: "asem",
    });
  });

  test("final confirmation summary lists defaults and all materialized templates", async () => {
    const prompts = new FakePrompts();
    prompts.checkboxAnswers = [
      ["pi", "claude"],
      ["tmux", "herdr"],
    ];
    prompts.selectAnswers = ["pi", "tmux"];
    prompts.confirmAnswers = [true];

    await runInitWizard({ ...BASE, prompts });

    const message = prompts.confirms[0]!.message;
    expect(message).toContain("Workspace: asem");
    expect(message).toContain("Default Agent Template: pi");
    expect(message).toContain("Agent Templates: claude, pi");
    expect(message).toContain("Default Multiplexer Template: tmux");
    expect(message).toContain("Multiplexer Templates: herdr, tmux");
    expect(message).toContain("Config: /repo/asem/.asem.yaml");
  });

  test("returns cancelled when final confirmation is declined", async () => {
    const prompts = new FakePrompts();
    prompts.confirmAnswers = [false];

    const result = await runInitWizard({ ...BASE, prompts });

    expect(result).toEqual({ kind: "cancelled" });
  });

  test("returns cancelled when a prompt is interrupted", async () => {
    const prompts = new FakePrompts();
    prompts.cancelOn = "checkbox";

    const result = await runInitWizard({ ...BASE, prompts });

    expect(result).toEqual({ kind: "cancelled" });
  });
});
