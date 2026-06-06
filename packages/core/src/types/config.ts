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

export const configSchema = z
  .object({
    workspace: workspaceConfigSchema,
    mux: muxConfigSchema.default({ default: "herdr", templates: {} }),
    agent: agentConfigSchema.default({ default: "claude", templates: {} }),
  })
  .strict();

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
export type MuxConfig = z.infer<typeof muxConfigSchema>;
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type Config = z.infer<typeof configSchema>;
