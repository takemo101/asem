import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYBAR, type LeftRow } from "../src/index.ts";
import {
  FOOTER_HEIGHT,
  keybarText,
} from "../src/opentui/components/footer.tsx";
import {
  listWindow,
  rowText,
  sessionListWidthForTerminal,
} from "../src/opentui/components/session-list.tsx";
import {
  noticeKey,
  noticeToastPayload,
  TOASTER_OPTIONS,
} from "../src/opentui/notice-toast.tsx";
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
      location: "/repo/b",
    };
    expect(rowText(group)).toBe("▾ /repo/b");
    // Session rows carry a compact location badge (the worktree root basename).
    expect(rowText(session)).toBe("›   ● helper-2 +2 * @b");
  });

  test("listWindow keeps the selection visible", () => {
    expect(listWindow(3, 0, 10)).toEqual({ start: 0, end: 3 });
    expect(listWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(listWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
    const mid = listWindow(20, 10, 5);
    expect(mid.start).toBeLessThanOrEqual(10);
    expect(mid.end).toBeGreaterThan(10);
  });

  test("sessionListWidthForTerminal keeps narrow terminals at the old width", () => {
    expect(sessionListWidthForTerminal(80)).toBe(36);
    expect(sessionListWidthForTerminal(100)).toBe(36);
  });

  test("sessionListWidthForTerminal widens medium terminals", () => {
    expect(sessionListWidthForTerminal(140)).toBe(44);
  });

  test("sessionListWidthForTerminal caps very wide terminals", () => {
    expect(sessionListWidthForTerminal(240)).toBe(56);
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

  test("footer height is compact after notices moved to toast", () => {
    expect(typeof FOOTER_HEIGHT).toBe("number");
    expect(FOOTER_HEIGHT).toBe(3);
  });
});

describe("notice toast bridge", () => {
  test("noticeKey dedupes identical notices and ignores null", () => {
    expect(
      noticeKey({ level: "error", message: "boom", code: "timeout" }),
    ).toBe(noticeKey({ level: "error", message: "boom", code: "timeout" }));
    expect(noticeKey({ level: "info", message: "refreshed" })).not.toBe(
      noticeKey({ level: "success", message: "refreshed" }),
    );
    expect(noticeKey(null)).toBeNull();
  });

  test("noticeToastPayload maps error code to description", () => {
    expect(
      noticeToastPayload({ level: "error", message: "boom", code: "timeout" }),
    ).toEqual({
      method: "error",
      message: "boom",
      options: { description: "code: timeout", duration: 10000 },
    });
  });

  test("noticeToastPayload maps success and info durations", () => {
    expect(noticeToastPayload({ level: "success", message: "sent" })).toEqual({
      method: "success",
      message: "sent",
      options: { duration: 4000 },
    });
    expect(noticeToastPayload({ level: "info", message: "refreshed" })).toEqual(
      {
        method: "info",
        message: "refreshed",
        options: { duration: 4000 },
      },
    );
  });

  test("toaster options keep notices in the top-right corner", () => {
    expect(TOASTER_OPTIONS.position).toBe("top-right");
    expect(TOASTER_OPTIONS.stackingMode).toBe("single");
    expect(TOASTER_OPTIONS.offset?.top).toBe(1);
    expect(TOASTER_OPTIONS.offset?.right).toBe(2);
    expect("bottom" in TOASTER_OPTIONS.offset).toBe(false);
  });
});
