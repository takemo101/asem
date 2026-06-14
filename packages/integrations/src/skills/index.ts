/**
 * Skill installer registry and dispatch.
 *
 * `installSkillForTarget` writes the shared asem SKILL.md to one Integration
 * Target's resolved location. Repeating the install is an idempotent repair: the
 * asem-owned file is replaced with the current document. Unknown targets fail
 * with a stable error.
 */
import {
  type InstallOptions,
  type InstallResult,
  integrationTargetError,
  writeTextFileAtomic,
} from "../shared.ts";
import { skillDocument } from "./document.ts";
import { skillTargets } from "./targets.ts";

export { skillDocument } from "./document.ts";

export function installSkillForTarget(
  target: string,
  options: InstallOptions = {},
): InstallResult {
  const adapter = skillTargets.find((entry) => entry.target === target);
  if (!adapter) {
    throw integrationTargetError(
      "unknown_target",
      `Unknown Integration Target: ${target}`,
    );
  }
  const { path, scope } = adapter.resolveTarget(options);
  writeTextFileAtomic(path, skillDocument);
  return { target: adapter.target, path, scope };
}
