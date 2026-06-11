import { describe, expect, test } from "bun:test";
import {
  createTemplateRegistry,
  type MuxTemplate,
  renderAttachCommand,
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

describe("renderAttachCommand: builtin mux templates", () => {
  test("tmux renders a structured attach argv instead of a shell string", () => {
    const command = renderAttachCommand(muxTemplate("tmux").attach_command, {
      tmux_session_name: "asem-s_0001",
    });
    expect(command).toEqual({
      argv: ["tmux", "attach-session", "-t", "asem-s_0001"],
    });
  });

  test("zellij renders a structured attach argv with the short socket dir", () => {
    const command = renderAttachCommand(muxTemplate("zellij").attach_command, {
      zellij_session_name: "as-s_0001",
    });
    expect(command).toEqual({
      argv: [
        "sh",
        "-c",
        "mkdir -p \"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" && ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" exec zellij attach 'as-s_0001'",
      ],
    });
  });

  test("herdr renders a structured sh attach argv", () => {
    const command = renderAttachCommand(muxTemplate("herdr").attach_command, {
      herdr_session: "asem",
      herdr_workspace_id: "w 1",
      tab_id: "w:2",
    });
    expect(command).toEqual({
      argv: [
        "sh",
        "-c",
        "herdr --session 'asem' workspace focus 'w 1' >/dev/null && herdr --session 'asem' tab focus 'w:2' >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
      ],
    });
  });
});

describe("renderAttachHint: builtin mux templates", () => {
  test("herdr renders a workspace-scoped attach hint", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      herdr_workspace_id: "w",
      tab_id: "w:2",
      herdr_session: "asem",
    });
    expect(hint).toContain("herdr --session 'asem' workspace focus 'w'");
    expect(hint).toContain("herdr --session 'asem' tab focus 'w:2'");
    expect(hint).toContain(
      "if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
    );
  });

  test("tmux renders a session attach hint", () => {
    const hint = renderAttachHint(muxTemplate("tmux").attach, {
      tmux_session_name: "main",
    });
    expect(hint).toBe("tmux attach-session -t 'main'");
  });

  test("zellij renders a session attach hint with the short socket dir", () => {
    const hint = renderAttachHint(muxTemplate("zellij").attach, {
      zellij_session_name: "s_0001",
    });
    expect(hint).toBe(
      "mkdir -p \"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" && ZELLIJ_SOCKET_DIR=\"${ZELLIJ_SOCKET_DIR:-/tmp/zellij}\" zellij attach 's_0001'",
    );
  });

  test("shell-escapes herdr refs containing spaces or metacharacters", () => {
    const hint = renderAttachHint(muxTemplate("herdr").attach, {
      herdr_workspace_id: "w; rm -rf /",
      tab_id: "tab with space",
      herdr_session: "session with space",
    });
    expect(hint).toContain("herdr --session 'session with space'");
    expect(hint).toContain("workspace focus 'w; rm -rf /'");
    expect(hint).toContain("tab focus 'tab with space'");
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
