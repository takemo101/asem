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
      command: "pi {{model_shell}} {{prompt_shell}}",
      model_flag: "--model",
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

  test("omits empty default fields from materialized mux templates", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "claude",
      mux: "herdr",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.mux.templates.herdr).not.toHaveProperty("refs");
    expect(result.value.mux.templates.herdr).not.toHaveProperty(
      "attach_command",
      [],
    );
  });

  test("keeps non-empty mux refs in block-renderable object form", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.mux.templates.tmux).toMatchObject({
      refs: { tmux_session_name: "{{session_id}}" },
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
      command: "opencode {{model_shell}}",
      model_flag: "--model",
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

  test("materializes multiple selected templates, default included, sorted, deduped", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
      // prompt selection order is intentionally not ascending and has a dupe
      agents: ["pi", "claude", "pi"],
      muxes: ["tmux", "herdr", "herdr"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.agent.default).toBe("pi");
    // emitted in builtin-name ascending order, deduped
    expect(Object.keys(result.value.agent.templates)).toEqual(["claude", "pi"]);
    expect(result.value.mux.default).toBe("tmux");
    expect(Object.keys(result.value.mux.templates)).toEqual(["herdr", "tmux"]);
  });

  test("always includes the default even when omitted from selected arrays", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
      agents: ["claude"],
      muxes: ["herdr"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    expect(result.value.agent.default).toBe("pi");
    expect(Object.keys(result.value.agent.templates)).toEqual(["claude", "pi"]);
    expect(result.value.mux.default).toBe("tmux");
    expect(Object.keys(result.value.mux.templates)).toEqual(["herdr", "tmux"]);
  });

  test("rejects unknown names in selected arrays", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "pi",
      mux: "tmux",
      agents: ["pi", "not-an-agent"],
      muxes: ["tmux"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.message).toContain("unknown agent template");
  });

  test("preserves MIK-034 hook fields across multiple materialized templates", () => {
    const result = materializeInitConfig({
      workspaceId: "ws_1",
      agent: "claude",
      mux: "herdr",
      agents: ["claude", "opencode"],
      muxes: ["herdr"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    // claude stays minimal (no empty hooks emitted) but carries its model_flag...
    expect(result.value.agent.templates.claude).toEqual({
      command: "claude {{model_shell}} {{prompt_shell}}",
      model_flag: "--model",
    });
    // ...while opencode keeps its meaningful paste fields plus model support.
    expect(result.value.agent.templates.opencode).toEqual({
      command: "opencode {{model_shell}}",
      model_flag: "--model",
      paste_prompt: true,
      before_paste: [{ type: "wait_ms", ms: 750 }],
    });
  });
});
