import { describe, expect, test } from "bun:test";
import { MESSAGE_PAGE_MAX_LIMIT } from "@asem/core";
import {
  badgeCount,
  messageRows,
  newIncomingMessageIds,
  observeSession,
  relatedMessages,
  seedBaseline,
} from "../src/index.ts";
import { makeMessage, makeSession } from "./helpers.ts";

describe("messageRows", () => {
  test("returns related Messages chronological ascending", () => {
    const sel = makeSession({ id: "sel" });
    const m1 = makeMessage({
      id: "m1",
      toSessionId: "sel",
      createdAt: "2026-06-05T12:00:03.000Z",
    });
    const m2 = makeMessage({
      id: "m2",
      fromSessionId: "sel",
      toSessionId: "other",
      createdAt: "2026-06-05T12:00:01.000Z",
    });
    const unrelated = makeMessage({
      id: "x",
      toSessionId: "other",
      createdAt: "2026-06-05T12:00:02.000Z",
    });

    const rows = messageRows([m1, m2, unrelated], "sel", [sel]);
    expect(rows.map((r) => r.message.id)).toEqual(["m2", "m1"]);
  });

  test("marks delivery errors and exposes delivery state", () => {
    const failed = makeMessage({
      id: "f",
      toSessionId: "sel",
      deliveredAt: null,
      deliveryError: "sequence_step_failed: pane gone",
    });
    const delivered = makeMessage({
      id: "d",
      toSessionId: "sel",
      deliveredAt: "2026-06-05T12:00:05.000Z",
      deliveryError: null,
    });

    const rows = messageRows([failed, delivered], "sel", []);
    const failedRow = rows.find((r) => r.message.id === "f")!;
    const okRow = rows.find((r) => r.message.id === "d")!;
    expect(failedRow.hasDeliveryError).toBe(true);
    expect(failedRow.deliveryError).toContain("sequence_step_failed");
    expect(failedRow.delivered).toBe(false);
    expect(okRow.hasDeliveryError).toBe(false);
    expect(okRow.delivered).toBe(true);
  });

  test("labels sender/recipient by name and 'external' for human sends", () => {
    const sel = makeSession({ id: "sel", name: "reviewer-1" });
    const parent = makeSession({ id: "p", name: "parent" });
    const fromParent = makeMessage({
      id: "m1",
      fromSessionId: "p",
      toSessionId: "sel",
    });
    const fromHuman = makeMessage({
      id: "m2",
      fromSessionId: null,
      toSessionId: "sel",
    });

    const rows = messageRows([fromParent, fromHuman], "sel", [sel, parent]);
    const r1 = rows.find((r) => r.message.id === "m1")!;
    const r2 = rows.find((r) => r.message.id === "m2")!;
    expect(r1.fromLabel).toBe("parent");
    expect(r1.toLabel).toBe("reviewer-1");
    expect(r2.fromLabel).toBe("external");
  });

  test("derives HH:MM from the stored timestamp without timezone math", () => {
    const m = makeMessage({
      id: "m",
      toSessionId: "sel",
      createdAt: "2026-06-05T10:05:00.000Z",
    });
    const rows = messageRows([m], "sel", []);
    expect(rows[0]!.timeLabel).toBe("10:05");
  });

  test("renders the full internal snapshot beyond one public page limit", () => {
    // The cockpit consumes the explicitly internal Workspace snapshot, not the
    // public paginated list, so its rows are never capped at a page size.
    const sel = makeSession({ id: "sel" });
    const total = MESSAGE_PAGE_MAX_LIMIT + 10;
    const messages = Array.from({ length: total }, (_, i) =>
      makeMessage({
        id: `m_bulk_${String(i).padStart(3, "0")}`,
        toSessionId: "sel",
      }),
    );
    expect(messageRows(messages, "sel", [sel])).toHaveLength(total);
  });

  test("derives direction and counterpart relative to the selected Session", () => {
    const sel = makeSession({ id: "sel", name: "reviewer-1" });
    const parent = makeSession({ id: "p", name: "parent" });
    const incoming = makeMessage({
      id: "m1",
      fromSessionId: "p",
      toSessionId: "sel",
    });
    const outgoing = makeMessage({
      id: "m2",
      fromSessionId: "sel",
      toSessionId: "p",
    });

    const rows = messageRows([incoming, outgoing], "sel", [sel, parent]);
    const inRow = rows.find((r) => r.message.id === "m1")!;
    const outRow = rows.find((r) => r.message.id === "m2")!;
    expect(inRow.direction).toBe("in");
    expect(inRow.counterpartLabel).toBe("parent");
    expect(outRow.direction).toBe("out");
    expect(outRow.counterpartLabel).toBe("parent");
  });

  test("reports are expanded by default; ordinary Messages are previews", () => {
    const report = makeMessage({
      id: "r1",
      toSessionId: "sel",
      kind: "report",
      body: "line1\nline2",
    });
    const ordinary = makeMessage({
      id: "m1",
      toSessionId: "sel",
      body: "first\nsecond",
    });

    const rows = messageRows([report, ordinary], "sel", []);
    expect(rows.find((r) => r.message.id === "r1")!.expanded).toBe(true);
    expect(rows.find((r) => r.message.id === "m1")!.expanded).toBe(false);
  });

  test("ordinary Messages expand through ephemeral expansion ids", () => {
    const ordinary = makeMessage({ id: "m1", toSessionId: "sel", body: "hi" });
    const rows = messageRows([ordinary], "sel", [], {
      expandedMessageIds: new Set(["m1"]),
    });
    expect(rows[0]!.expanded).toBe(true);
  });

  test("previewLabel compacts the body to one truncated line", () => {
    const short = makeMessage({ id: "a", toSessionId: "sel", body: "hi" });
    const multiline = makeMessage({
      id: "b",
      toSessionId: "sel",
      body: "first\nsecond",
    });
    const long = makeMessage({
      id: "c",
      toSessionId: "sel",
      body: "x".repeat(80),
    });

    const rows = messageRows([short, multiline, long], "sel", []);
    expect(rows.find((r) => r.message.id === "a")!.previewLabel).toBe("hi");
    expect(rows.find((r) => r.message.id === "b")!.previewLabel).toBe("first…");
    const longPreview = rows.find((r) => r.message.id === "c")!.previewLabel;
    expect(longPreview.length).toBeLessThanOrEqual(61);
    expect(longPreview.endsWith("…")).toBe(true);
  });

  test("a delivery error yields the exact durable failed notice", () => {
    const failed = makeMessage({
      id: "f",
      toSessionId: "sel",
      deliveryError: "pane gone",
    });
    const ok = makeMessage({
      id: "d",
      toSessionId: "sel",
      deliveredAt: "2026-06-05T12:00:05.000Z",
    });

    const rows = messageRows([failed, ok], "sel", []);
    expect(rows.find((r) => r.message.id === "f")!.failedNoticeLabel).toBe(
      "Notification failed · Message is stored · no auto-resend",
    );
    expect(
      rows.find((r) => r.message.id === "d")!.failedNoticeLabel,
    ).toBeNull();
  });

  test("relatedMessages includes both sent and received", () => {
    const to = makeMessage({ id: "a", toSessionId: "sel" });
    const from = makeMessage({
      id: "b",
      fromSessionId: "sel",
      toSessionId: "x",
    });
    const other = makeMessage({ id: "c", toSessionId: "x" });
    const ids = relatedMessages([to, from, other], "sel").map((m) => m.id);
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});

describe("ephemeral badges", () => {
  test("seedBaseline marks all existing Messages as observed (no badges)", () => {
    const m = makeMessage({ id: "m", toSessionId: "sel" });
    const baseline = seedBaseline([m]);
    expect(badgeCount([m], "sel", baseline)).toBe(0);
  });

  test("Messages arriving after the baseline are counted as new (incoming only)", () => {
    const old = makeMessage({ id: "old", toSessionId: "sel" });
    const baseline = seedBaseline([old]);

    const newIn = makeMessage({ id: "new", toSessionId: "sel" });
    const outgoing = makeMessage({
      id: "out",
      fromSessionId: "sel",
      toSessionId: "x",
    });

    const all = [old, newIn, outgoing];
    expect(badgeCount(all, "sel", baseline)).toBe(1);
    expect(newIncomingMessageIds(all, "sel", baseline)).toEqual(["new"]);
  });

  test("observeSession folds new Messages into the baseline, resetting the badge", () => {
    const baseline = new Set<string>();
    const m = makeMessage({ id: "m", toSessionId: "sel" });
    expect(badgeCount([m], "sel", baseline)).toBe(1);

    const observed = observeSession([m], "sel", baseline);
    expect(badgeCount([m], "sel", observed)).toBe(0);
    // The original baseline is not mutated (purity).
    expect(baseline.has("m")).toBe(false);
  });
});
