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
  test("herdr renders the agent attach command from the captured pane ref", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      pane_id: "w-3",
    });
    expect(hint).toBe("herdr agent attach 'w-3'");
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

  test("shell-escapes refs containing spaces or metacharacters", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      pane_id: "pane; rm -rf /",
    });
    expect(hint).toBe("herdr agent attach 'pane; rm -rf /'");
  });
});

describe("renderAttachHint: no usable hint", () => {
  test("returns undefined when a referenced ref is missing", () => {
    // herdr's attach needs `pane_id`; without it there is no safe command.
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
