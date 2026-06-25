import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkillForTarget, skillDocument } from "../src/skills/index.ts";

const allTargets = [
  "pi",
  "antigravity",
  "jcode",
  "claude-code",
  "opencode",
  "codex",
  "copilot-vscode",
  "copilot-cli",
] as const;

describe("installSkillForTarget", () => {
  test("supports the mikan parity target set", () => {
    const home = mktemp();
    for (const target of allTargets) {
      const result = installSkillForTarget(target, {
        home,
        cwd: join(home, "repo"),
        global: true,
      });
      expect(result.target).toBe(target);
      expect(readFileSync(result.path, "utf8")).toBe(skillDocument);
    }
  });

  test("pi global writes ~/.pi/agent/skills/asem/SKILL.md", () => {
    const home = mktemp();
    const result = installSkillForTarget("pi", { home });
    expect(result).toEqual({
      target: "pi",
      path: join(home, ".pi", "agent", "skills", "asem", "SKILL.md"),
      scope: "global",
    });
  });

  test("pi workspace writes .pi/skills/asem/SKILL.md", () => {
    const cwd = join(mktemp(), "repo");
    const result = installSkillForTarget("pi", { cwd, global: false });
    expect(result).toEqual({
      target: "pi",
      path: join(cwd, ".pi", "skills", "asem", "SKILL.md"),
      scope: "workspace",
    });
  });

  test("claude-code writes SKILL.md under .claude/skills/asem", () => {
    const cwd = join(mktemp(), "repo");
    const result = installSkillForTarget("claude-code", { cwd, global: false });
    expect(result.path).toBe(
      join(cwd, ".claude", "skills", "asem", "SKILL.md"),
    );
  });

  test("antigravity workspace writes .agents/skills/asem/SKILL.md", () => {
    const cwd = join(mktemp(), "repo");
    const result = installSkillForTarget("antigravity", { cwd, global: false });
    expect(result.path).toBe(
      join(cwd, ".agents", "skills", "asem", "SKILL.md"),
    );
  });

  test("copilot-vscode supports both scopes via skills dirs", () => {
    const home = mktemp();
    const global = installSkillForTarget("copilot-vscode", { home });
    expect(global.path).toBe(
      join(home, ".copilot", "skills", "asem", "SKILL.md"),
    );
    const cwd = join(mktemp(), "repo");
    const workspace = installSkillForTarget("copilot-vscode", {
      cwd,
      global: false,
    });
    expect(workspace.path).toBe(
      join(cwd, ".github", "skills", "asem", "SKILL.md"),
    );
  });

  test("codex rejects workspace skills when unsupported", () => {
    expect(() =>
      installSkillForTarget("codex", { cwd: mktemp(), global: false }),
    ).toThrow("codex does not support workspace Skill scope");
  });

  test("the shared document is a concise operational playbook", () => {
    expect(skillDocument).toContain("name: asem");
    expect(skillDocument).toContain("## When to use");
    expect(skillDocument).toContain("## Use MCP first");
    expect(skillDocument).toContain("## Normal playbook");
    expect(skillDocument).toContain("## Workspace repo aliases");
    expect(skillDocument).toContain("## Boundaries");
    expect(skillDocument).not.toContain("## Vocabulary");
    expect(skillDocument.length).toBeLessThan(3_600);
  });

  test("teaches when to use asem without broadening its scope", () => {
    expect(skillDocument).toMatch(/separate agent Session/i);
    expect(skillDocument).toMatch(/durable Messages\/Reports/i);
    expect(skillDocument).toMatch(/independent review/i);
    expect(skillDocument).toMatch(/workspace\/repo scoped supervision/i);
    expect(skillDocument).toMatch(
      /Do not use asem as a task manager or workflow engine/i,
    );
  });

  test("maps MCP tools to CLI fallbacks", () => {
    for (const tool of [
      "create_session",
      "send_message",
      "list_messages",
      "report_parent",
      "close_session",
    ]) {
      expect(skillDocument).toContain(tool);
    }
    for (const command of [
      "asem session create",
      "asem message send",
      "asem message wait",
      "asem report parent",
      "asem session close",
      "asem workspace repo list",
    ]) {
      expect(skillDocument).toContain(command);
    }
  });

  test("teaches the implementation review repair loop", () => {
    expect(skillDocument).toMatch(/Create a bounded worker Session/i);
    expect(skillDocument).toMatch(/Wait for its Report/i);
    expect(skillDocument).toMatch(/Create a separate reviewer Session/i);
    expect(skillDocument).toMatch(/send the worker a Message/i);
    expect(skillDocument).toMatch(/Close child Sessions/i);
    expect(skillDocument).toMatch(/do not delete history/i);
  });

  test("teaches workspace-root Repo Alias operation as a cwd shortcut", () => {
    expect(skillDocument).toContain("Repo Alias");
    expect(skillDocument).toContain(
      "asem session create frontend-parent --repo frontend --root --prompt",
    );
    expect(skillDocument).toMatch(/--repo is only a cwd alias/i);
    expect(skillDocument).toMatch(
      /repo parent Sessions create their own repo-local child Sessions/i,
    );
    expect(skillDocument).toContain("asem tui --scope workspace");
  });

  test("teaches repo parent Sessions to report to a root parent via CLI or MCP", () => {
    expect(skillDocument).toMatch(/same Effective Scope/i);
    expect(skillDocument).toContain(
      "asem session create frontend-parent --repo frontend --parent <root-session-id>",
    );
    expect(skillDocument).toContain("asem report parent --body");
    expect(skillDocument).toContain(
      'create_session({ parentSessionId: "<root-session-id>" });',
    );
    expect(skillDocument).toContain(
      'report_parent({ body: "frontend report" });',
    );
  });

  test("keeps asem scope guards intact", () => {
    expect(skillDocument).toMatch(/Session status is process state/i);
    expect(skillDocument).toMatch(/Report is communication, not completion/i);
    expect(skillDocument).toMatch(
      /Do not invent cross-worktree Parent\/Report\/Message semantics/i,
    );
    expect(skillDocument).toMatch(/Do not edit \.asem runtime files directly/i);
  });

  test("unknown target fails", () => {
    expect(() => installSkillForTarget("nope", { home: mktemp() })).toThrow(
      "Unknown Integration Target: nope",
    );
  });
});

function mktemp(): string {
  return join(tmpdir(), `asem-integrations-${crypto.randomUUID()}`);
}
