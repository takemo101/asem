/**
 * Live-renderer regression tests for the right pane's timeline layout and
 * scrolling (MIK-069). These render the real OpenTUI `DetailPane` through
 * `@opentui/react/test-utils` and assert on captured character frames, so they
 * cover the actual renderer behavior — not just the pure line projection:
 * long Report entries must keep their block structure (no interleaved rows),
 * and Messages/Detail/Context content beyond the pane height must be reachable
 * by scrolling while the dossier/tab/activity chrome stays fixed.
 */
import { describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { TabHeader } from "../src/index.ts";
import {
  DETAIL_BODY_SCROLLBOX_ID,
  DetailPane,
} from "../src/opentui/components/detail-pane.tsx";
import type { ActivityRowView } from "../src/view/activity-row.ts";
import { TIMELINE_RULE } from "../src/view/right-pane.ts";
import type { DossierView } from "../src/view.ts";

const WIDTH = 60;
const HEIGHT = 16;
/** Pane content rows: the terminal height minus the pane's own border. */
const MAX_VISIBLE_ROWS = HEIGHT - 2;

function tabsFor(active: "messages" | "detail" | "context"): TabHeader[] {
  return [
    { tab: "messages", title: "Messages", active: active === "messages" },
    { tab: "detail", title: "Detail", active: active === "detail" },
    { tab: "context", title: "Context", active: active === "context" },
  ];
}

const ACTIVITY: ActivityRowView[] = [
  { timeLabel: "10:10", text: "+ demo activity", tone: "add" },
  { timeLabel: "10:11", text: "! warn activity", tone: "warn" },
];

const DOSSIER: DossierView = {
  status: "running",
  symbol: "●",
  name: "worker-1",
  agent: "claude",
  mux: "tmux",
  profile: null,
  updatedLabel: "updated just now",
};

async function renderPane(props: {
  dossier: DossierView | null;
  tabs: TabHeader[];
  lines: string[];
  activity: ActivityRowView[];
}) {
  const context = await testRender(
    <DetailPane {...props} maxVisibleRows={MAX_VISIBLE_ROWS} />,
    { width: WIDTH, height: HEIGHT },
  );
  await context.renderOnce();
  return context;
}

/** Frame rows without the pane border, scrollbar glyphs, and padding. */
function innerRows(frame: string): string[] {
  return frame
    .split("\n")
    .filter((row) => row.includes("│"))
    .map((row) => row.replaceAll(/[│█░▒]/g, "").trim());
}

describe("timeline block layout (long Report)", () => {
  const longBody =
    "  alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu";

  test("overflowing report entries never interleave rows and keep separators intact", async () => {
    const lines = [
      "10:05 IN  report · parent",
      longBody,
      longBody,
      longBody,
      TIMELINE_RULE,
      "10:09 OUT message · child",
      "  short reply",
      TIMELINE_RULE,
      "10:15 OUT report · parent",
      "  tail entry body",
    ];
    const context = await renderPane({
      dossier: null,
      tabs: tabsFor("messages"),
      lines,
      activity: ACTIVITY,
    });
    try {
      const rows = innerRows(context.captureCharFrame());
      // The first entry header renders as its own intact row (the screenshot
      // failure interleaved it with body characters: "10alphaNbravoo…").
      expect(rows).toContain("10:05 IN  report · parent");
      // Any row that starts like a timestamp must be a well-formed entry
      // header — the failure mode fused body text into it ("10alphaNbravoo…").
      for (const row of rows.filter((r) => /^\d/.test(r))) {
        expect(row).toMatch(/^\d{2}:\d{2} (IN {2}|OUT |\+ |! |· )\S/);
      }

      // The separators sit below the fold now; scroll to them and verify
      // every timeline rule row stays a pure separator — never fused with a
      // neighboring entry's text ("────────erra tango…").
      for (let step = 0; step < 40; step += 1) {
        await context.mockMouse.scroll(WIDTH / 2, 6, "down");
      }
      await context.renderOnce();
      const scrolledRows = innerRows(context.captureCharFrame());
      const ruleRows = scrolledRows.filter((row) =>
        row.includes(TIMELINE_RULE),
      );
      expect(ruleRows.length).toBeGreaterThan(0);
      for (const row of ruleRows) {
        expect(row).toBe(TIMELINE_RULE);
      }
      expect(scrolledRows).toContain("10:15 OUT report · parent");
      for (const row of scrolledRows.filter((r) => /^\d/.test(r))) {
        expect(row).toMatch(/^\d{2}:\d{2} (IN {2}|OUT |\+ |! |· )\S/);
      }
    } finally {
      context.renderer.destroy();
    }
  });
});

describe("messages scrolling beyond pane height", () => {
  const entries = Array.from(
    { length: 30 },
    (_, index) => `entry-${String(index).padStart(2, "0")} body`,
  );

  test("mouse wheel reveals timeline content beyond the visible rows", async () => {
    const context = await renderPane({
      dossier: null,
      tabs: tabsFor("messages"),
      lines: entries,
      activity: ACTIVITY,
    });
    try {
      const before = context.captureCharFrame();
      expect(before).toContain("entry-00");
      expect(before).not.toContain("entry-29");

      for (let step = 0; step < 40; step += 1) {
        await context.mockMouse.scroll(WIDTH / 2, 6, "down");
      }
      await context.renderOnce();

      const after = context.captureCharFrame();
      expect(after).toContain("entry-29");
      // Fixed chrome survives the scroll: tab bar and activity strip.
      expect(after).toContain("[Messages]");
      expect(after).toContain("Activity");
      expect(after).toContain("+ demo activity");
    } finally {
      context.renderer.destroy();
    }
  });
});

describe("detail scrolling beyond pane height", () => {
  const detailLines = [
    "Session",
    ...Array.from(
      { length: 40 },
      (_, index) => `  field_${index}:  value-${index}`,
    ),
  ];

  test("scrollbox exposes detail rows beyond the visible height", async () => {
    const context = await renderPane({
      dossier: DOSSIER,
      tabs: tabsFor("detail"),
      lines: detailLines,
      activity: ACTIVITY,
    });
    try {
      const before = context.captureCharFrame();
      expect(before).toContain("field_0:");
      expect(before).not.toContain("value-39");

      const scrollbox = context.renderer.root.findDescendantById(
        DETAIL_BODY_SCROLLBOX_ID,
      ) as ScrollBoxRenderable | undefined;
      expect(scrollbox).toBeDefined();
      scrollbox?.scrollTo({ x: 0, y: detailLines.length });
      await context.renderOnce();

      const after = context.captureCharFrame();
      expect(after).toContain("value-39");
      // Fixed chrome survives the scroll: dossier, tab bar, activity strip.
      expect(after).toContain("● worker-1 · running");
      expect(after).toContain("[Detail]");
      expect(after).toContain("Activity");
    } finally {
      context.renderer.destroy();
    }
  });
});

describe("context scrolling beyond pane height", () => {
  // A Relationship section with more children than the pane can show, plus a
  // Workspace section whose long value wraps — both used to be silently cut
  // off by the old slice(0, bodyRows) special case.
  const contextLines = [
    "Relationship",
    "  parent: coordinator-1",
    ...Array.from(
      { length: 25 },
      (_, index) => `  child: worker-${String(index).padStart(2, "0")}`,
    ),
    "Workspace",
    "  path: /very/long/workspace/path/that/keeps/going/and/going/until/it/wraps/around/the/pane",
    "  branch: feature/context-tail-marker",
  ];

  test("mouse wheel reveals relationship children and workspace data below the fold", async () => {
    const context = await renderPane({
      dossier: DOSSIER,
      tabs: tabsFor("context"),
      lines: contextLines,
      activity: ACTIVITY,
    });
    try {
      const before = context.captureCharFrame();
      expect(before).toContain("Relationship");
      expect(before).toContain("child: worker-00");
      expect(before).not.toContain("context-tail-marker");

      for (let step = 0; step < 60; step += 1) {
        await context.mockMouse.scroll(WIDTH / 2, 6, "down");
      }
      await context.renderOnce();

      const after = context.captureCharFrame();
      expect(after).toContain("context-tail-marker");
      // Fixed chrome survives the scroll: dossier, tab bar, activity strip.
      expect(after).toContain("● worker-1 · running");
      expect(after).toContain("[Context]");
      expect(after).toContain("Activity");
      expect(after).toContain("+ demo activity");
    } finally {
      context.renderer.destroy();
    }
  });
});
