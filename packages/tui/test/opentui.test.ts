import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYBAR, type LeftRow } from "../src/index.ts";
import {
  FOOTER_HEIGHT,
  keybarText,
  statusLineText,
} from "../src/opentui/components/footer.tsx";
import {
  listWindow,
  rowText,
} from "../src/opentui/components/session-list.tsx";
import { activityAccent, statusAccent, theme } from "../src/opentui/theme.ts";

describe("opentui isolation", () => {
  test("the @asem/tui root entry never imports the OpenTUI renderer", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/index.ts"),
      "utf8",
    );
    expect(source).not.toContain("opentui");
  });

  test("no MCP source imports OpenTUI or @asem/tui", () => {
    const mcpSrc = join(import.meta.dir, "../../mcp/src");
    for (const entry of readdirSync(mcpSrc, { recursive: true })) {
      const path = join(mcpSrc, String(entry));
      if (!path.endsWith(".ts") && !path.endsWith(".tsx")) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("@opentui");
      expect(source).not.toContain("@asem/tui");
    }
  });
});

describe("opentui theme", () => {
  test("status accents stay process-state oriented", () => {
    expect(statusAccent("running")).toBe(theme.green);
    expect(statusAccent("missing")).toBe(theme.red);
    expect(statusAccent("starting")).toBe(theme.cyan);
    expect(statusAccent("exited")).toBe(theme.muted);
    expect(statusAccent("closed")).toBe(theme.yellow);
  });

  test("activity tones map to accents", () => {
    expect(activityAccent("add")).toBe(theme.green);
    expect(activityAccent("warn")).toBe(theme.yellow);
    expect(activityAccent("remove")).toBe(theme.muted);
    expect(activityAccent("info")).toBe(theme.text);
  });
});

describe("session list rows", () => {
  test("renders group headers and marked session rows", () => {
    const group: LeftRow = { kind: "group", worktreeRoot: "/repo/b" };
    const session: LeftRow = {
      kind: "session",
      sessionId: "s1",
      name: "helper-2",
      depth: 1,
      status: "running",
      symbol: "●",
      selected: true,
      badge: 2,
      isNew: true,
    };
    expect(rowText(group)).toBe("▾ /repo/b");
    expect(rowText(session)).toBe("›   ● helper-2 +2 *");
  });

  test("listWindow keeps the selection visible", () => {
    expect(listWindow(3, 0, 10)).toEqual({ start: 0, end: 3 });
    expect(listWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(listWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
    const mid = listWindow(20, 10, 5);
    expect(mid.start).toBeLessThanOrEqual(10);
    expect(mid.end).toBeGreaterThan(10);
  });
});

describe("footer", () => {
  test("keybar text includes every key and the auto state", () => {
    const text = keybarText([...KEYBAR], "auto 3s");
    for (const item of KEYBAR) {
      expect(text).toContain(`${item.key} ${item.label}`);
    }
    expect(text).toContain("auto 3s");
  });

  test("footer height is constant regardless of the status line", () => {
    // A single fixed height: the layout must not jump when a status appears.
    expect(typeof FOOTER_HEIGHT).toBe("number");
    expect(FOOTER_HEIGHT).toBe(4);
  });

  test("statusLineText clamps to a single bounded line", () => {
    expect(statusLineText(null)).toBe("");
    expect(statusLineText("refreshed")).toBe("refreshed");
    // Multiline errors collapse to their first line.
    expect(statusLineText("error: timeout: boom\nstack trace\nmore")).toBe(
      "error: timeout: boom",
    );
    // Very long lines are truncated so they cannot wrap the footer.
    const long = `error: ${"x".repeat(500)}`;
    const clamped = statusLineText(long);
    expect(clamped.length).toBeLessThanOrEqual(160);
    expect(clamped.endsWith("…")).toBe(true);
  });
});
