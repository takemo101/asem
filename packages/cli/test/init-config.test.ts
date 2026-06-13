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
    // Empty hook/sequence fields and the default paste_prompt are omitted.
    expect(result.value.agent.templates.pi).toEqual({
      command: "pi {{prompt_shell}}",
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

  test("keeps paste_prompt and before_paste for the paste builtin", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "opencode",
      mux: "tmux",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.agent.templates.opencode).toEqual({
      command: "opencode",
      paste_prompt: true,
      before_paste: [{ type: "wait_ms", ms: 750 }],
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
