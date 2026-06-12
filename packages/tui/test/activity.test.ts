import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_CAP,
  type ActivityItem,
  appendActivity,
  applySnapshot,
  type CockpitSnapshot,
  createCockpitState,
  diffSnapshots,
  newSessionIds,
  renderCockpitView,
} from "../src/index.ts";
import { makeEnv, makeMessage, makeSession, WORKTREE_B } from "./helpers.ts";

function snapshot(
  sessions: ReturnType<typeof makeSession>[] = [],
  messages: ReturnType<typeof makeMessage>[] = [],
): CockpitSnapshot {
  return { sessions, messages };
}

describe("diffSnapshots", () => {
  test("an unchanged snapshot yields no activity", () => {
    const s = makeSession({ id: "s1" });
    const m = makeMessage({ id: "m1", toSessionId: "s1" });
    expect(diffSnapshots(snapshot([s], [m]), snapshot([s], [m]))).toEqual([]);
  });

  test("a new Session id produces session_added", () => {
    const before = makeSession({ id: "s1" });
    const added = makeSession({
      id: "s2",
      name: "helper-2",
      worktreeRoot: WORKTREE_B,
      createdAt: "2026-06-12T12:05:00.000Z",
    });
    const items = diffSnapshots(snapshot([before]), snapshot([before, added]));
    expect(items).toEqual([
      {
        kind: "session_added",
        sessionId: "s2",
        sessionName: "helper-2",
        worktreeRoot: WORKTREE_B,
        at: "2026-06-12T12:05:00.000Z",
      },
    ]);
  });

  test("a disappeared Session id produces session_removed", () => {
    const kept = makeSession({ id: "s1" });
    const removed = makeSession({ id: "s2", name: "gone" });
    const items = diffSnapshots(snapshot([kept, removed]), snapshot([kept]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "session_removed",
      sessionId: "s2",
      sessionName: "gone",
    });
  });

  test("a process status change produces status_changed (not an outcome)", () => {
    const before = makeSession({ id: "s1", name: "reviewer" });
    const after = {
      ...before,
      status: "missing" as const,
      updatedAt: "2026-06-12T12:07:00.000Z",
    };
    const items = diffSnapshots(snapshot([before]), snapshot([after]));
    expect(items).toEqual([
      {
        kind: "status_changed",
        sessionId: "s1",
        sessionName: "reviewer",
        worktreeRoot: before.worktreeRoot,
        from: "running",
        to: "missing",
        at: "2026-06-12T12:07:00.000Z",
      },
    ]);
  });

  test("a new Message id produces message_added with resolved labels", () => {
    const target = makeSession({ id: "s1", name: "reviewer" });
    const message = makeMessage({
      id: "m1",
      fromSessionId: null,
      toSessionId: "s1",
      kind: "message",
      createdAt: "2026-06-12T12:05:00.000Z",
    });
    const items = diffSnapshots(
      snapshot([target]),
      snapshot([target], [message]),
    );
    expect(items).toEqual([
      {
        kind: "message_added",
        messageId: "m1",
        fromLabel: "external",
        toLabel: "reviewer",
        messageKind: "message",
        at: "2026-06-12T12:05:00.000Z",
      },
    ]);
  });

  test("a delivery result change produces delivery_changed", () => {
    const target = makeSession({ id: "s1", name: "reviewer" });
    const pending = makeMessage({ id: "m1", toSessionId: "s1" });
    const failed = { ...pending, deliveryError: "pane gone" };
    const delivered = {
      ...pending,
      deliveredAt: "2026-06-12T12:06:00.000Z",
    };

    const errorItems = diffSnapshots(
      snapshot([target], [pending]),
      snapshot([target], [failed]),
    );
    expect(errorItems).toEqual([
      {
        kind: "delivery_changed",
        messageId: "m1",
        toLabel: "reviewer",
        result: "error",
        deliveryError: "pane gone",
        at: pending.createdAt,
      },
    ]);

    const okItems = diffSnapshots(
      snapshot([target], [failed]),
      snapshot([target], [delivered]),
    );
    expect(okItems).toEqual([
      {
        kind: "delivery_changed",
        messageId: "m1",
        toLabel: "reviewer",
        result: "delivered",
        deliveryError: null,
        at: "2026-06-12T12:06:00.000Z",
      },
    ]);
  });
});

describe("appendActivity", () => {
  test("caps the list to the latest rows", () => {
    const items: ActivityItem[] = Array.from(
      { length: ACTIVITY_CAP + 3 },
      (_, i) => ({
        kind: "session_added",
        sessionId: `s${i}`,
        sessionName: `s${i}`,
        worktreeRoot: "/repo/a",
        at: "2026-06-12T12:00:00.000Z",
      }),
    );
    const capped = appendActivity([], items);
    expect(capped).toHaveLength(ACTIVITY_CAP);
    expect(capped[0]).toMatchObject({ sessionId: "s3" });
    expect(capped[ACTIVITY_CAP - 1]).toMatchObject({
      sessionId: `s${ACTIVITY_CAP + 2}`,
    });
  });

  test("returns the same list when nothing changed", () => {
    const activity: ActivityItem[] = [];
    expect(appendActivity(activity, [])).toBe(activity);
  });
});

describe("activity in cockpit state and view", () => {
  test("starts empty and accrues rows on applySnapshot", () => {
    const first = makeSession({ id: "s1", name: "parent" });
    const state = createCockpitState(makeEnv(), snapshot([first]));
    expect(state.activity).toEqual([]);

    const added = makeSession({ id: "s2", name: "helper-2" });
    const next = applySnapshot(state, snapshot([first, added]));
    expect(next.activity).toHaveLength(1);
    expect(next.activity[0]).toMatchObject({
      kind: "session_added",
      sessionId: "s2",
    });

    // The view projects the strip and marks the new Session's row.
    const view = renderCockpitView(next);
    expect(view.activity).toHaveLength(1);
    expect(view.activity[0]?.text).toContain("new Session helper-2");
    expect(view.activity[0]?.tone).toBe("add");
    const row = view.left.rows.find(
      (r) => r.kind === "session" && r.sessionId === "s2",
    );
    expect(row).toMatchObject({ isNew: true });
    const oldRow = view.left.rows.find(
      (r) => r.kind === "session" && r.sessionId === "s1",
    );
    expect(oldRow).toMatchObject({ isNew: false });
  });

  test("a new incoming Message produces activity and an ephemeral badge", () => {
    const a = makeSession({ id: "s1", name: "parent" });
    const b = makeSession({ id: "s2", name: "reviewer" });
    const state = createCockpitState(makeEnv(), snapshot([a, b]));

    const incoming = makeMessage({ id: "m1", toSessionId: "s2" });
    const next = applySnapshot(state, snapshot([a, b], [incoming]));
    expect(next.activity).toHaveLength(1);
    expect(next.activity[0]).toMatchObject({
      kind: "message_added",
      toLabel: "reviewer",
    });

    // Selection stays on s1 (Messages tab observes s1, not s2) → badge on s2.
    const view = renderCockpitView(next);
    const row = view.left.rows.find(
      (r) => r.kind === "session" && r.sessionId === "s2",
    );
    expect(row).toMatchObject({ badge: 1 });
  });

  test("refresh preserves selection and removal falls back", () => {
    const a = makeSession({ id: "s1", name: "a" });
    const b = makeSession({ id: "s2", name: "b" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    state = { ...state, selectedSessionId: "s2" };

    // New Session appearing above does not steal selection.
    const c = makeSession({ id: "s0", name: "c" });
    state = applySnapshot(state, snapshot([c, a, b]));
    expect(state.selectedSessionId).toBe("s2");

    // Removing the selected Session falls back to a visible row, with activity.
    state = applySnapshot(state, snapshot([c, a]));
    expect(state.selectedSessionId).not.toBe("s2");
    expect(state.selectedSessionId).not.toBeNull();
    expect(
      state.activity.some(
        (i) => i.kind === "session_removed" && i.sessionId === "s2",
      ),
    ).toBe(true);
  });
});

describe("newSessionIds", () => {
  test("collects only session_added ids still in the capped list", () => {
    const items: ActivityItem[] = [
      {
        kind: "session_added",
        sessionId: "s1",
        sessionName: "a",
        worktreeRoot: "/repo/a",
        at: "2026-06-12T12:00:00.000Z",
      },
      {
        kind: "session_removed",
        sessionId: "s2",
        sessionName: "b",
        worktreeRoot: "/repo/a",
        at: "2026-06-12T12:00:00.000Z",
      },
    ];
    expect([...newSessionIds(items)]).toEqual(["s1"]);
  });
});
