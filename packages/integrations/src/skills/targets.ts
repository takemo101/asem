/**
 * Skill target adapters.
 *
 * Each adapter resolves only where the shared asem SKILL.md is written for one
 * Integration Target. Paths mirror mikan's skill installers (verified against
 * real installs), with `asem` as the skill directory name. Targets that have no
 * verified workspace-local skill convention reject `--no-global` rather than
 * write a file the client would ignore.
 */
import {
  homePath,
  type InstallOptions,
  type InstallScope,
  type IntegrationTarget,
  integrationTargetError,
  isGlobalScope,
  workspacePath,
} from "../shared.ts";

export type SkillTargetAdapter = {
  target: IntegrationTarget;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
};

export const skillTargets: SkillTargetAdapter[] = [
  {
    target: "pi",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(
              options,
              ".pi",
              "agent",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "global",
          }
        : {
            path: workspacePath(options, ".pi", "skills", "asem", "SKILL.md"),
            scope: "workspace",
          },
  },
  {
    target: "claude-code",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".claude", "skills", "asem", "SKILL.md"),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".claude",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
  {
    target: "codex",
    resolveTarget: (options) => {
      if (!isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "codex does not support workspace Skill scope; re-run without --no-global to install into ~/.codex/skills/",
        );
      }
      return {
        path: homePath(options, ".codex", "skills", "asem", "SKILL.md"),
        scope: "global",
      };
    },
  },
  {
    target: "opencode",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(
              options,
              ".config",
              "opencode",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".opencode",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
  {
    target: "jcode",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".jcode", "skills", "asem", "SKILL.md"),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".jcode",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
  {
    target: "antigravity",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(
              options,
              ".gemini",
              "antigravity-cli",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".agents",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
  {
    target: "copilot-vscode",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".copilot", "skills", "asem", "SKILL.md"),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".github",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
  {
    target: "copilot-cli",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? {
            path: homePath(options, ".copilot", "skills", "asem", "SKILL.md"),
            scope: "global",
          }
        : {
            path: workspacePath(
              options,
              ".github",
              "skills",
              "asem",
              "SKILL.md",
            ),
            scope: "workspace",
          },
  },
];
