/**
 * Effective prompt rendering for Agent Profiles (MIK-041).
 *
 * When a profile is selected, the effective prompt places the profile
 * instructions first and the caller's original prompt second, under fixed
 * headings. The original user prompt is preserved exactly under `# User Prompt`
 * (design "Prompt composition"); `@asem/ops` writes the result to `prompt.md` and
 * uses it for `paste_prompt` delivery too.
 */
import type { ResolvedProfile } from "./types.ts";

/** The profile fields the effective prompt header needs. */
export type RenderableProfile = Pick<
  ResolvedProfile,
  "id" | "source" | "instructions"
>;

/**
 * Render the effective prompt: profile header + instructions, then the original
 * user prompt verbatim under `# User Prompt`. The user prompt is inserted exactly
 * as given (no trimming or rewrapping) so it round-trips for audit.
 */
export function renderProfilePrompt(
  profile: RenderableProfile,
  userPrompt: string,
): string {
  return [
    "# Agent Profile",
    "",
    `Profile: ${profile.id}`,
    `Source: ${profile.source}`,
    "",
    profile.instructions,
    "",
    "# User Prompt",
    "",
    userPrompt,
  ].join("\n");
}
