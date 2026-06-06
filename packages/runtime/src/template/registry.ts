import type {
  Config,
  TemplateRegistry,
  TemplateRegistryFactory,
} from "@asem/core";
import { builtinAgentTemplates, builtinMuxTemplates } from "./builtin.ts";
import {
  type AgentTemplate,
  agentTemplateSchema,
  type MuxTemplate,
  muxTemplateSchema,
} from "./schema.ts";

/**
 * Template registry: resolves mux and agent templates by name.
 *
 * Builtin and project-local definitions resolve through the same typed path —
 * both are raw `unknown` records parsed by {@link muxTemplateSchema} /
 * {@link agentTemplateSchema} (implementation principle 13: one resolution path
 * for builtin and project-local templates). Project-local definitions override
 * builtins of the same name; project-local templates are trusted like local
 * code but are still parsed, never merely checked.
 *
 * A missing name resolves to `undefined` so callers (`@asem/ops`) can raise
 * `mux_template_not_found` / `agent_template_not_found`. An invalid definition
 * throws, since a malformed template is a configuration defect.
 */

export interface TemplateRegistryOptions {
  /** Project-local mux template definitions (raw, from `.asem.yaml`). */
  muxTemplates?: Readonly<Record<string, unknown>>;
  /** Project-local agent template definitions (raw, from `.asem.yaml`). */
  agentTemplates?: Readonly<Record<string, unknown>>;
  /** Override builtin sets (primarily for tests). */
  builtinMux?: Readonly<Record<string, unknown>>;
  builtinAgent?: Readonly<Record<string, unknown>>;
}

/** A {@link TemplateRegistry} with parsed, typed return values. */
export interface TypedTemplateRegistry extends TemplateRegistry {
  getMuxTemplate(name: string): MuxTemplate | undefined;
  getAgentTemplate(name: string): AgentTemplate | undefined;
  /** Names resolvable as mux templates (project-local plus builtin). */
  muxTemplateNames(): string[];
  /** Names resolvable as agent templates (project-local plus builtin). */
  agentTemplateNames(): string[];
}

class DefaultTemplateRegistry implements TypedTemplateRegistry {
  private readonly muxRaw: Record<string, unknown>;
  private readonly agentRaw: Record<string, unknown>;
  private readonly muxCache = new Map<string, MuxTemplate>();
  private readonly agentCache = new Map<string, AgentTemplate>();

  constructor(options: TemplateRegistryOptions) {
    // Builtins first, then project-local definitions override by name.
    this.muxRaw = {
      ...(options.builtinMux ?? builtinMuxTemplates),
      ...(options.muxTemplates ?? {}),
    };
    this.agentRaw = {
      ...(options.builtinAgent ?? builtinAgentTemplates),
      ...(options.agentTemplates ?? {}),
    };
  }

  getMuxTemplate(name: string): MuxTemplate | undefined {
    const cached = this.muxCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    if (!Object.hasOwn(this.muxRaw, name)) {
      return undefined;
    }
    const parsed = muxTemplateSchema.parse(this.muxRaw[name]);
    this.muxCache.set(name, parsed);
    return parsed;
  }

  getAgentTemplate(name: string): AgentTemplate | undefined {
    const cached = this.agentCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    if (!Object.hasOwn(this.agentRaw, name)) {
      return undefined;
    }
    const parsed = agentTemplateSchema.parse(this.agentRaw[name]);
    this.agentCache.set(name, parsed);
    return parsed;
  }

  muxTemplateNames(): string[] {
    return Object.keys(this.muxRaw);
  }

  agentTemplateNames(): string[] {
    return Object.keys(this.agentRaw);
  }
}

/** Create a {@link TypedTemplateRegistry} over builtin and project templates. */
export function createTemplateRegistry(
  options: TemplateRegistryOptions = {},
): TypedTemplateRegistry {
  return new DefaultTemplateRegistry(options);
}

/**
 * Default {@link TemplateRegistryFactory}: for a resolved {@link Config}, layer
 * its project-local `mux.templates` / `agent.templates` over the builtins
 * through {@link createTemplateRegistry}. This is the seam real CLI/MCP/TUI deps
 * use so an operation sees the project-local templates declared for its `cwd`'s
 * `.asem.yaml`, while builtins stay available when those maps are empty.
 */
export function createTemplateRegistryFactory(): TemplateRegistryFactory {
  return {
    forConfig(config: Config): TypedTemplateRegistry {
      return createTemplateRegistry({
        muxTemplates: config.mux.templates,
        agentTemplates: config.agent.templates,
      });
    },
  };
}
