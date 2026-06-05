import { describe, expect, test } from "bun:test";
import { createTemplateRegistry } from "../src/index.ts";

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
      command: "claude",
      prompt_delivery: "arg",
      after_start: [],
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
  });

  test("project-local templates override builtins of the same name", () => {
    const registry = createTemplateRegistry({
      agentTemplates: {
        claude: { command: "claude-custom", prompt_delivery: "stdin" },
      },
    });
    expect(registry.getAgentTemplate("claude")?.command).toBe("claude-custom");
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
