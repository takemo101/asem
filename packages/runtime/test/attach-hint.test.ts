import { describe, expect, test } from "bun:test";
import {
  createTemplateRegistry,
  type MuxTemplate,
  renderAttachHint,
} from "../src/index.ts";

/**
 * Attach-hint rendering tests (MIK-021).
 *
 * `renderAttachHint` turns a mux template's `attach` sequence plus a Session's
 * captured mux refs into a single human/operator attach command. These exercise
 * the builtin herdr / tmux / zellij attach sequences purely as string
 * interpolation — no real multiplexer binary is involved (implementation
 * principle 4) — and assert the fallback when refs are missing.
 */

function muxTemplate(name: string): MuxTemplate {
  const template = createTemplateRegistry().getMuxTemplate(name);
  expect(template).toBeDefined();
  return template as MuxTemplate;
}

describe("renderAttachHint: builtin mux templates", () => {
  test("herdr renders a stable-label resolver instead of a compactable pane ref", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      pane_id: "stale-pane",
      herdr_workspace_id: "w",
      herdr_label: "s_0001",
    });
    expect(hint).toContain("HERDR_LABEL='s_0001'");
    expect(hint).toContain("HERDR_WORKSPACE_ID='w'");
    expect(hint).toContain('&& herdr agent focus "$pane_id"');
    expect(hint).toContain('&& herdr session attach "${HERDR_SESSION:-default}"');
    expect(hint).not.toContain("herdr agent attach");
    expect(hint).not.toContain("stale-pane");
  });

  test("tmux joins the multi-step attach into one runnable line", () => {
    const hint = renderAttachHint(muxTemplate("tmux").attach, {
      session_name: "main",
      window_id: "@1",
      pane_id: "%2",
    });
    expect(hint).toBe(
      "tmux select-window -t '@1' && tmux select-pane -t '%2' && tmux attach-session -t 'main'",
    );
  });

  test("zellij focuses the captured tab", () => {
    const hint = renderAttachHint(muxTemplate("zellij").attach, {
      tab_name: "s_0001",
    });
    expect(hint).toBe("zellij action go-to-tab-name 's_0001'");
  });

  test("shell-escapes herdr resolver refs containing spaces or metacharacters", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      herdr_workspace_id: "w; rm -rf /",
      herdr_label: "label with space",
    });
    expect(hint).toContain("HERDR_LABEL='label with space'");
    expect(hint).toContain("HERDR_WORKSPACE_ID='w; rm -rf /'");
  });
});

describe("renderAttachHint: no usable hint", () => {
  test("returns undefined when a referenced ref is missing", () => {
    // herdr's attach needs stable resolver refs; without them there is no safe command.
    expect(renderAttachHint(muxTemplate("herdr").attach, {})).toBeUndefined();
  });

  test("returns undefined for an empty attach sequence", () => {
    expect(renderAttachHint([], { pane_id: "w-3" })).toBeUndefined();
  });

  test("skips non-run steps and returns undefined when only those remain", () => {
    expect(
      renderAttachHint([{ type: "wait_ms", ms: 10 }], { pane_id: "w-3" }),
    ).toBeUndefined();
  });
});
