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

  test("unknown target fails", () => {
    expect(() => installSkillForTarget("nope", { home: mktemp() })).toThrow(
      "Unknown Integration Target: nope",
    );
  });
});

function mktemp(): string {
  return join(tmpdir(), `asem-integrations-${crypto.randomUUID()}`);
}
