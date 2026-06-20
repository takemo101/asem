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

  test("the shared document uses asem Integration Target vocabulary", () => {
    expect(skillDocument).toContain("name: asem");
    expect(skillDocument).toContain("Integration Target");
    expect(skillDocument).toContain("Session");
    expect(skillDocument).not.toContain("Session Agent");
  });

  test("teaches normal Session operation patterns", () => {
    expect(skillDocument).toContain("report_parent");
    expect(skillDocument).toContain("worker");
    expect(skillDocument).toContain("reviewer");
    // Close child Sessions after work, but preserve history.
    expect(skillDocument).toMatch(/close .*child Sessions/i);
    expect(skillDocument).toMatch(/preserve history/i);
    expect(skillDocument).toMatch(/do not delete Sessions/i);
  });

  test("teaches MCP-first with CLI fallback commands", () => {
    expect(skillDocument).toContain("asem session create");
    expect(skillDocument).toContain("asem message send");
    expect(skillDocument).toContain("asem message wait");
    expect(skillDocument).toContain("asem report parent");
    expect(skillDocument).toContain("asem session close");
    expect(skillDocument).toContain("asem workspace repo list");
  });

  test("teaches workspace-root Repo Alias operation", () => {
    expect(skillDocument).toContain("Repo Alias");
    expect(skillDocument).toContain(
      "asem session create <name> --repo <alias> --root --prompt",
    );
    // Repo Alias is only a cwd shortcut, not a new scope boundary.
    expect(skillDocument).toMatch(/--repo\W+is only [^.]*cwd/i);
    expect(skillDocument).toContain("asem tui --scope workspace");
  });

  test("keeps asem scope guards intact", () => {
    expect(skillDocument).toMatch(/cross-worktree/i);
    expect(skillDocument).toMatch(/do not infer task completion/i);
    expect(skillDocument).toMatch(/Agent Profiles? into workflow roles/i);
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
