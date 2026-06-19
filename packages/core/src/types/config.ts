import { z } from "zod";
import { nonEmptyString } from "./common.ts";

/**
 * Parsed shape of `.asem.yaml`.
 *
 * Template contents are intentionally left opaque (`record`) here: the typed
 * template schemas are owned by `@asem/runtime`. The runtime `TemplateRegistry`
 * factory layers these project-local `mux.templates` / `agent.templates` over
 * the builtins and parses each definition through that one resolution path, so
 * core never duplicates the template schema.
 */
export const muxConfigSchema = z
  .object({
    default: nonEmptyString.default("herdr"),
    templates: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const agentConfigSchema = z
  .object({
    default: nonEmptyString.default("claude"),
    templates: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const workspaceConfigSchema = z
  .object({
    id: nonEmptyString,
  })
  .strict();

/**
 * One Repo Alias entry: a human CLI convenience naming a directory used as the
 * `cwd` for Session creation (`session create --repo <alias>`). `path` is
 * resolved relative to the `.asem.yaml` that declares it. A Repo Alias is only a
 * cwd shortcut — it introduces no cross-worktree Parent Session, Message, or
 * Report semantics (CONTEXT.md "Repo Alias"; design "Repo alias creation").
 */
export const repoAliasSchema = z
  .object({
    path: nonEmptyString,
  })
  .strict();

export const configSchema = z
  .object({
    workspace: workspaceConfigSchema,
    /**
     * Optional map of Repo Aliases. Absent when no aliases are declared; the CLI
     * `--repo`/`workspace repo list` conveniences resolve entries here. Kept
     * optional rather than defaulted so a config that declares none stays clean.
     */
    repos: z.record(z.string(), repoAliasSchema).optional(),
    mux: muxConfigSchema.default({ default: "herdr", templates: {} }),
    agent: agentConfigSchema.default({ default: "claude", templates: {} }),
  })
  .strict();

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type MuxConfig = z.infer<typeof muxConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type RepoAlias = z.infer<typeof repoAliasSchema>;
export type Config = z.infer<typeof configSchema>;
