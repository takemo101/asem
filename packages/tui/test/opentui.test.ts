import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { KEYBAR, type LeftRow, type TabHeader } from "../src/index.ts";
import { DetailPane } from "../src/opentui/components/detail-pane.tsx";
import {
  FOOTER_HEIGHT,
  keybarText,
} from "../src/opentui/components/footer.tsx";
import {
  desiredSessionListScrollTop,
  rowText,
  SessionRowsScrollBox,
  scrollDirectionToSelectionKey,
  selectedRowElementId,
  sessionListWidthForTerminal,
} from "../src/opentui/components/session-list.tsx";
import {
  noticeKey,
  noticeToastPayload,
  TOASTER_OPTIONS,
} from "../src/opentui/notice-toast.tsx";
import {
  activityAccent,
  statusAccent,
  theme,
  timelineAccent,
} from "../src/opentui/theme.ts";
import { timelineLineTone } from "../src/view/right-pane.ts";

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
    // Calm-terminal palette: amber for starting (spec "Goal").
    expect(statusAccent("starting")).toBe(theme.yellow);
    expect(statusAccent("exited")).toBe(theme.muted);
    expect(statusAccent("closed")).toBe(theme.yellow);
  });

  test("activity tones map to accents", () => {
    expect(activityAccent("add")).toBe(theme.green);
    expect(activityAccent("warn")).toBe(theme.yellow);
    expect(activityAccent("remove")).toBe(theme.muted);
    expect(activityAccent("info")).toBe(theme.text);
  });

  test("timeline tones: green incoming, amber outgoing, red durable failure", () => {
    expect(timelineAccent("in")).toBe(theme.green);
    expect(timelineAccent("out")).toBe(theme.yellow);
    expect(timelineAccent("failure")).toBe(theme.red);
  });
});

describe("timeline line tones", () => {
  test("classifies ledger headers, the durable notice, and body lines", () => {
    expect(timelineLineTone("10:05 IN  message · parent")).toBe("in");
    expect(timelineLineTone("10:09 OUT report · parent")).toBe("out");
    expect(
      timelineLineTone(
        "  Notification failed · Message is stored · no auto-resend",
      ),
    ).toBe("failure");
    expect(timelineLineTone("  body preview…")).toBeNull();
    expect(timelineLineTone("────────")).toBeNull();
  });

  test("DetailPane colors Messages-tab lines by tone", () => {
    const tabs: TabHeader[] = [
      { tab: "messages", title: "Messages", active: true },
      { tab: "detail", title: "Detail", active: false },
      { tab: "context", title: "Context", active: false },
    ];
    const lines = [
      "10:05 IN  message · parent",
      "  hello",
      "  Notification failed · Message is stored · no auto-resend",
      "10:09 OUT report · parent",
    ];
    const pane = DetailPane({
      dossier: null,
      tabs,
      lines,
      activity: [],
      maxVisibleRows: 20,
    }) as ReactElement;

    const texts = collectTexts(pane);
    const fgFor = (content: string) =>
      texts.find((t) => t.content === content)?.fg;
    expect(fgFor("10:05 IN  message · parent")).toBe(theme.green);
    expect(fgFor("  hello")).toBe(theme.text);
    expect(
      fgFor("  Notification failed · Message is stored · no auto-resend"),
    ).toBe(theme.red);
    expect(fgFor("10:09 OUT report · parent")).toBe(theme.yellow);
  });

  test("DetailPane keeps non-Messages tabs on the plain text color", () => {
    const tabs: TabHeader[] = [
      { tab: "messages", title: "Messages", active: false },
      { tab: "detail", title: "Detail", active: true },
      { tab: "context", title: "Context", active: false },
    ];
    const pane = DetailPane({
      dossier: null,
      tabs,
      lines: ["Session", "  status:        running"],
      activity: [],
      maxVisibleRows: 20,
    }) as ReactElement;
    const texts = collectTexts(pane);
    expect(texts.some((t) => t.content.includes("Session"))).toBe(true);
    for (const text of texts.filter((t) => !t.content.includes("["))) {
      expect(text.fg).toBe(theme.text);
    }
  });
});

/** Collect every <text> element's fg and joined string content, depth-first. */
function collectTexts(
  node: ReactNode,
): Array<{ fg?: string; content: string }> {
  if (!isValidElement(node)) {
    return [];
  }
  const props = node.props as { fg?: string; children?: ReactNode };
  if (node.type === "text") {
    const content = Children.toArray(props.children ?? [])
      .filter((child) => typeof child === "string")
      .join("");
    return [{ ...(props.fg === undefined ? {} : { fg: props.fg }), content }];
  }
  return Children.toArray(props.children ?? []).flatMap(collectTexts);
}

function reactChildren(node: ReactNode): ReactNode[] {
  return Children.toArray(node);
}

function reactProps(element: ReactElement): { children?: ReactNode } {
  return element.props as { children?: ReactNode };
}

function isReactElement(node: ReactNode): node is ReactElement {
  return isValidElement(node);
}

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

  test("renders Session rows inside a vertical scrollbox", () => {
    const rows: LeftRow[] = Array.from({ length: 6 }, (_, index) => ({
      kind: "session",
      sessionId: `s${index}`,
      name: `helper-${index}`,
      depth: 0,
      status: "running",
      symbol: "●",
      selected: index === 4,
      badge: 0,
      isNew: false,
      location: "/repo/asem",
    }));
    const scrollbox = SessionRowsScrollBox({
      rows,
      bodyRows: 3,
    }) as ReactElement;

    expect(scrollbox.type).toBe("scrollbox");
    expect(scrollbox.props).toMatchObject({ scrollY: true, scrollX: false });
    expect(reactChildren(reactProps(scrollbox).children)).toHaveLength(
      rows.length,
    );
    expect(selectedRowElementId(rows)).toBe("session-list-row:s4");
  });

  test("clips long Session rows to one visible line", () => {
    const rows: LeftRow[] = [
      {
        kind: "session",
        sessionId: "s1",
        name: "very-long-worker-name-that-would-overflow-the-left-panel",
        depth: 0,
        status: "running",
        symbol: "●",
        selected: true,
        badge: 0,
        isNew: false,
        location: "/repo/bookmark-ai-extension-with-a-very-long-name",
      },
    ];
    const scrollbox = SessionRowsScrollBox({
      rows,
      bodyRows: 1,
    }) as ReactElement;
    const rowBox = reactChildren(reactProps(scrollbox).children).at(0);
    if (!isReactElement(rowBox)) {
      throw new Error("expected a Session row box");
    }
    const rowTextElement = reactChildren(reactProps(rowBox).children).at(0);
    if (!isReactElement(rowTextElement)) {
      throw new Error("expected a Session row text element");
    }

    expect(rowBox.props).toMatchObject({
      height: 1,
      overflow: "hidden",
      width: "100%",
    });
    expect(rowTextElement.props).toMatchObject({
      height: 1,
      truncate: true,
      width: "100%",
      wrapMode: "none",
    });
  });

  test("maps mouse scroll direction to selection movement", () => {
    expect(scrollDirectionToSelectionKey("down")).toEqual({ key: "down" });
    expect(scrollDirectionToSelectionKey("up")).toEqual({ key: "up" });
    expect(scrollDirectionToSelectionKey("left")).toBeNull();
    expect(scrollDirectionToSelectionKey("right")).toBeNull();
  });

  test("keeps keyboard selection scroll adjustments stable", () => {
    const rows: LeftRow[] = Array.from({ length: 12 }, (_, index) => ({
      kind: "session",
      sessionId: `s${index}`,
      name: `helper-${index}`,
      depth: 0,
      status: "running",
      symbol: "●",
      selected: index === 0,
      badge: 0,
      isNew: false,
      location: "/repo/asem",
    }));

    expect(desiredSessionListScrollTop(rows, "s2", 0, 5)).toBe(0);
    expect(desiredSessionListScrollTop(rows, "s5", 0, 5)).toBe(1);
    expect(desiredSessionListScrollTop(rows, "s6", 1, 5)).toBe(2);
    expect(desiredSessionListScrollTop(rows, "s5", 2, 5)).toBe(2);
    expect(desiredSessionListScrollTop(rows, "s1", 2, 5)).toBe(1);
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
