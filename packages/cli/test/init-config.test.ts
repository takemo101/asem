import { describe, expect, test } from "bun:test";
import { materializeInitConfig } from "../src/init-config.ts";

describe("materializeInitConfig", () => {
  test("materializes only the selected builtin agent and mux templates", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.workspace.id).toBe("ws_1");
    expect(result.value.agent.default).toBe("pi");
    expect(Object.keys(result.value.agent.templates)).toEqual(["pi"]);
    expect(result.value.agent.templates.pi).toEqual({
      command: "pi",
      prompt_delivery: "arg",
      after_start: [],
    });

    expect(result.value.mux.default).toBe("tmux");
    expect(Object.keys(result.value.mux.templates)).toEqual(["tmux"]);
    expect(result.value.mux.templates.tmux).toMatchObject({
      create: expect.any(Array),
      run_in_pane: expect.any(Array),
      send: expect.any(Array),
      attach: expect.any(Array),
      close: expect.any(Array),
    });
  });

  test("rejects unknown builtin selections", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "not-an-agent",
      mux: "tmux",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.message).toContain("unknown agent template");
    expect(String(result.error.details?.known)).toContain("pi");
  });
});
