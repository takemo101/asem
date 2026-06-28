import { describe, expect, test } from "bun:test";
import type { Config } from "@asem/core";
import {
  createTemplateRegistry,
  createTemplateRegistryFactory,
} from "../src/index.ts";

/** A `.asem.yaml`-shaped Config with the given project-local template maps. */
function configWith(
  templates: {
    mux?: Record<string, unknown>;
    agent?: Record<string, unknown>;
  } = {},
): Config {
  return {
    workspace: { id: "ws_1" },
    mux: { default: "herdr", templates: templates.mux ?? {} },
    agent: { default: "claude", templates: templates.agent ?? {} },
  };
}

describe("createTemplateRegistry", () => {
  test("resolves builtin mux templates through the typed path", () => {
    const registry = createTemplateRegistry();
    const herdr = registry.getMuxTemplate("herdr");
    expect(herdr).toBeDefined();
    // Parsed into the typed shape: every sequence is present as an array.
    expect(Array.isArray(herdr?.create)).toBe(true);
    expect(Array.isArray(herdr?.send)).toBe(true);
    expect(herdr?.create[0]?.type).toBe("run");
  });

  test("resolves builtin agent templates through the typed path", () => {
    const registry = createTemplateRegistry();
    const claude = registry.getAgentTemplate("claude");
    expect(claude).toEqual({
      command: "claude {{model_shell}} {{prompt_shell}}",
      model_flag: "--model",
      paste_prompt: false,
      before_paste: [],
      before_agent: [],
      after_agent: [],
    });
  });

  test("returns undefined for unknown names", () => {
    const registry = createTemplateRegistry();
    expect(registry.getMuxTemplate("nope")).toBeUndefined();
    expect(registry.getAgentTemplate("nope")).toBeUndefined();
  });

  test("project-local templates resolve through the same path", () => {
    const registry = createTemplateRegistry({
      muxTemplates: {
        custom: {
          send: [{ type: "run", command: "send {{message_shell}}" }],
        },
      },
    });
    const custom = registry.getMuxTemplate("custom");
    expect(custom?.send[0]?.type).toBe("run");
    // Unspecified sequences default to empty arrays.
    expect(custom?.create).toEqual([]);
    // An unspecified refs map defaults to empty.
    expect(custom?.refs).toEqual({});
  });

  test("a mux template may declare a refs map of interpolation templates", () => {
    const registry = createTemplateRegistry({
      muxTemplates: {
        custom: {
          refs: { mux_session_name: "asem-{{session_id}}" },
        },
      },
    });
    expect(registry.getMuxTemplate("custom")?.refs).toEqual({
      mux_session_name: "asem-{{session_id}}",
    });
  });

  test("a mux template may declare a peek sequence", () => {
    const registry = createTemplateRegistry({
      muxTemplates: {
        custom: {
          peek: [{ type: "run", command: "peek {{peek_lines_shell}}" }],
        },
      },
    });
    expect(registry.getMuxTemplate("custom")?.peek).toEqual([
      { type: "run", command: "peek {{peek_lines_shell}}" },
    ]);
  });

  test("project-local templates override builtins of the same name", () => {
    const registry = createTemplateRegistry({
      agentTemplates: {
        claude: { command: "claude-custom < {{prompt_path_shell}}" },
      },
    });
    expect(registry.getAgentTemplate("claude")?.command).toBe(
      "claude-custom < {{prompt_path_shell}}",
    );
  });

  test("lists builtin plus project-local names", () => {
    const registry = createTemplateRegistry({
      muxTemplates: { custom: { send: [] } },
    });
    const names = registry.muxTemplateNames();
    expect(names).toContain("herdr");
    expect(names).toContain("custom");
  });

  test("an invalid template definition throws", () => {
    const registry = createTemplateRegistry({
      muxTemplates: { broken: { create: [{ type: "unknown_step" }] } },
    });
    expect(() => registry.getMuxTemplate("broken")).toThrow();
  });
});

/** Read `command` off a port-typed (opaque) agent template result. */
function agentCommand(template: unknown): string | undefined {
  return (template as { command?: string } | undefined)?.command;
}

describe("createTemplateRegistryFactory", () => {
  test("layers a config's project-local templates over the builtins", () => {
    const factory = createTemplateRegistryFactory();
    const registry = factory.forConfig(
      configWith({
        mux: { custom: { send: [{ type: "run", command: "send-it" }] } },
        agent: {
          claude: { command: "claude-custom {{prompt_shell}}" },
        },
      }),
    );
    // Project-local definition resolves...
    expect(registry.getMuxTemplate("custom")).toBeDefined();
    // ...overrides a builtin of the same name (factory returns the `TemplateRegistry`
    // port, whose values are opaque to callers that re-parse them)...
    expect(agentCommand(registry.getAgentTemplate("claude"))).toBe(
      "claude-custom {{prompt_shell}}",
    );
    // ...and builtins not overridden remain available.
    expect(registry.getMuxTemplate("herdr")).toBeDefined();
  });

  test("keeps builtins available when project-local maps are empty", () => {
    const factory = createTemplateRegistryFactory();
    const registry = factory.forConfig(configWith());
    expect(registry.getMuxTemplate("herdr")).toBeDefined();
    expect(agentCommand(registry.getAgentTemplate("claude"))).toBe(
      "claude {{model_shell}} {{prompt_shell}}",
    );
    expect(registry.getMuxTemplate("nope")).toBeUndefined();
  });
});
