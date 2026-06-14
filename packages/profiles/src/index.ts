/**
 * `@asem/profiles` — Agent Profile definitions, discovery, parsing, source
 * precedence, resolution, and effective prompt rendering (MIK-041, ADR 0007).
 *
 * Builds on `@asem/core` contracts (`ProfileSource`, the structured result
 * envelope). It performs filesystem reads only through an injected
 * {@link ProfileFs}, so it never touches a real filesystem in tests. It owns no
 * Session storage, no create-session side-effect ordering, and no surface
 * rendering — those stay in `@asem/ops` and the surfaces.
 */
export const PACKAGE_NAME = "@asem/profiles";

export { BUILTIN_PROFILES } from "./builtin.ts";
export { parseProfileFile } from "./parse.ts";
export { type RenderableProfile, renderProfilePrompt } from "./render.ts";
export { resolveProfile, resolveProfiles } from "./resolve.ts";
export type { ProfileDirs, ProfileFs, ResolvedProfile } from "./types.ts";
