import { describe, expect, test } from "bun:test";
import type { CockpitSnapshot } from "../src/index.ts";
import {
  applySnapshot,
  badgeFor,
  contextTab,
  createCockpitState,
  detailTab,
  dispatchCockpit,
  messagesTab,
  selectedSession,
  visibleSessionRows,
} from "../src/index.ts";
import { makeEnv, makeMessage, makeSession } from "./helpers.ts";

function snapshot(
  sessions: ReturnType<typeof makeSession>[],
  messages: ReturnType<typeof makeMessage>[] = [],
): CockpitSnapshot {
  return { sessions, messages };
}

describe("createCockpitState", () => {
  test("selects the first visible Session and defaults to the Messages tab", () => {
    const a = makeSession({ id: "a", createdAt: "2026-06-05T12:00:01.000Z" });
    const b = makeSession({ id: "b", createdAt: "2026-06-05T12:00:02.000Z" });
    const state = createCockpitState(makeEnv(), snapshot([b, a]));
    expect(state.selectedSessionId).toBe("a");
    expect(state.activeTab).toBe("messages");
  });

  test("selection is null when there are no Sessions", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    expect(state.selectedSessionId).toBeNull();
    expect(selectedSession(state)).toBeNull();
    expect(messagesTab(state)).toEqual([]);
    expect(detailTab(state)).toBeNull();
  });
});

describe("navigation", () => {
  test("selectNext / selectPrev move and clamp across visible rows", () => {
    const a = makeSession({ id: "a", createdAt: "2026-06-05T12:00:01.000Z" });
    const b = makeSession({ id: "b", createdAt: "2026-06-05T12:00:02.000Z" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    expect(state.selectedSessionId).toBe("a");

    state = dispatchCockpit(state, { type: "selectNext" }).state;
    expect(state.selectedSessionId).toBe("b");
    // Clamp at the end.
    state = dispatchCockpit(state, { type: "selectNext" }).state;
    expect(state.selectedSessionId).toBe("b");

    state = dispatchCockpit(state, { type: "selectPrev" }).state;
    expect(state.selectedSessionId).toBe("a");
    state = dispatchCockpit(state, { type: "selectPrev" }).state;
    expect(state.selectedSessionId).toBe("a");
  });

  test("select only honors visible Sessions", () => {
    const a = makeSession({ id: "a" });
    const state = createCockpitState(makeEnv(), snapshot([a]));
    const after = dispatchCockpit(state, {
      type: "select",
      sessionId: "ghost",
    }).state;
    expect(after.selectedSessionId).toBe("a");
  });
});

describe("tabs", () => {
  test("switchTab cycles messages -> detail -> context -> messages", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const t1 = dispatchCockpit(state, { type: "switchTab" }).state;
    expect(t1.activeTab).toBe("detail");
    const t2 = dispatchCockpit(t1, { type: "switchTab" }).state;
    expect(t2.activeTab).toBe("context");
    const t3 = dispatchCockpit(t2, { type: "switchTab" }).state;
    expect(t3.activeTab).toBe("messages");
  });

  test("context tab projects scope and the selected mux ref", () => {
    const session = makeSession({ muxRef: { pane: "p9" } });
    const state = createCockpitState(makeEnv(), snapshot([session]));
    const ctx = contextTab(state);
    expect(ctx.workspaceId).toBe("ws_1");
    expect(ctx.selectedMuxRefSummary).toBe("pane=p9");
  });
});

describe("filter", () => {
  test("cycleFilter advances the status filter and prunes the tree", () => {
    const running = makeSession({ id: "r", status: "running" });
    const closed = makeSession({ id: "c", status: "closed" });
    let state = createCockpitState(makeEnv(), snapshot([running, closed]));
    expect(visibleSessionRows(state)).toHaveLength(2);

    // all -> starting -> running
    state = dispatchCockpit(state, { type: "cycleFilter" }).state;
    state = dispatchCockpit(state, { type: "cycleFilter" }).state;
    expect(state.filter).toBe("running");
    const ids = visibleSessionRows(state).map((r) => r.session.id);
    expect(ids).toEqual(["r"]);
  });

  test("setFilter reselects when the selection is filtered out", () => {
    const running = makeSession({ id: "r", status: "running" });
    const closed = makeSession({ id: "c", status: "closed" });
    let state = createCockpitState(makeEnv(), snapshot([closed, running]));
    state = dispatchCockpit(state, { type: "select", sessionId: "c" }).state;
    expect(state.selectedSessionId).toBe("c");

    state = dispatchCockpit(state, {
      type: "setFilter",
      filter: "running",
    }).state;
    // 'c' is filtered out, so selection falls back to the first visible row.
    expect(state.selectedSessionId).toBe("r");
  });
});

describe("send modal", () => {
  test("open -> draft -> submit emits a send effect and closes the modal", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));

    state = dispatchCockpit(state, { type: "openSend" }).state;
    expect(state.modal.kind).toBe("send");

    state = dispatchCockpit(state, {
      type: "updateDraft",
      draft: "ping",
    }).state;
    expect(state.modal).toEqual({ kind: "send", draft: "ping" });

    const result = dispatchCockpit(state, { type: "submitSend" });
    expect(result.effect).toEqual({
      kind: "send",
      sessionId: "s1",
      body: "ping",
    });
    expect(result.state.modal.kind).toBe("none");
  });

  test("submitting an empty draft sends nothing and closes the modal", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));
    state = dispatchCockpit(state, { type: "openSend" }).state;
    const result = dispatchCockpit(state, { type: "submitSend" });
    expect(result.effect).toBeUndefined();
    expect(result.state.modal.kind).toBe("none");
  });

  test("cancelModal discards the draft", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));
    state = dispatchCockpit(state, { type: "openSend" }).state;
    state = dispatchCockpit(state, { type: "updateDraft", draft: "x" }).state;
    state = dispatchCockpit(state, { type: "cancelModal" }).state;
    expect(state.modal.kind).toBe("none");
  });
});

describe("close / delete confirmation", () => {
  test("requestClose sets a confirm modal but emits no effect", () => {
    const session = makeSession({ id: "s1" });
    const state = createCockpitState(makeEnv(), snapshot([session]));
    const result = dispatchCockpit(state, { type: "requestClose" });
    expect(result.effect).toBeUndefined();
    expect(result.state.modal).toEqual({
      kind: "confirm",
      action: "close",
      sessionId: "s1",
    });
  });

  test("confirm after requestClose emits the close effect", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));
    state = dispatchCockpit(state, { type: "requestClose" }).state;
    const result = dispatchCockpit(state, { type: "confirm" });
    expect(result.effect).toEqual({ kind: "close", sessionId: "s1" });
    expect(result.state.modal.kind).toBe("none");
  });

  test("confirm after requestDelete emits the delete effect", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));
    state = dispatchCockpit(state, { type: "requestDelete" }).state;
    const result = dispatchCockpit(state, { type: "confirm" });
    expect(result.effect).toEqual({ kind: "delete", sessionId: "s1" });
  });

  test("cancelModal aborts a pending confirmation without an effect", () => {
    const session = makeSession({ id: "s1" });
    let state = createCockpitState(makeEnv(), snapshot([session]));
    state = dispatchCockpit(state, { type: "requestDelete" }).state;
    const result = dispatchCockpit(state, { type: "cancelModal" });
    expect(result.effect).toBeUndefined();
    expect(result.state.modal.kind).toBe("none");
  });

  test("confirm with no pending confirmation is a no-op", () => {
    const session = makeSession({ id: "s1" });
    const state = createCockpitState(makeEnv(), snapshot([session]));
    const result = dispatchCockpit(state, { type: "confirm" });
    expect(result.effect).toBeUndefined();
  });
});

describe("error modal", () => {
  test("showError opens the error modal and cancelModal dismisses it", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const result = dispatchCockpit(state, {
      type: "showError",
      code: "session_not_found",
      message: "no such Session",
    });
    expect(result.effect).toBeUndefined();
    expect(result.state.modal).toEqual({
      kind: "error",
      code: "session_not_found",
      message: "no such Session",
    });
    const closed = dispatchCockpit(result.state, { type: "cancelModal" }).state;
    expect(closed.modal.kind).toBe("none");
  });

  test("showError never clobbers an open send draft", () => {
    let state = createCockpitState(
      makeEnv(),
      snapshot([makeSession({ id: "s1" })]),
    );
    state = dispatchCockpit(state, { type: "openSend" }).state;
    state = dispatchCockpit(state, {
      type: "updateDraft",
      draft: "keep me",
    }).state;
    const result = dispatchCockpit(state, {
      type: "showError",
      code: "timeout",
      message: "boom",
    });
    expect(result.effect).toBeUndefined();
    expect(result.state.modal).toEqual({ kind: "send", draft: "keep me" });
  });

  test("showError never clobbers a pending confirmation", () => {
    let state = createCockpitState(
      makeEnv(),
      snapshot([makeSession({ id: "s1" })]),
    );
    state = dispatchCockpit(state, { type: "requestDelete" }).state;
    const after = dispatchCockpit(state, {
      type: "showError",
      code: "timeout",
      message: "boom",
    }).state;
    expect(after.modal).toEqual({
      kind: "confirm",
      action: "delete",
      sessionId: "s1",
    });
  });
});

describe("attach / refresh / quit / help effects", () => {
  test("attach emits an attach effect for the selected Session", () => {
    const session = makeSession({ id: "s1" });
    const state = createCockpitState(makeEnv(), snapshot([session]));
    const result = dispatchCockpit(state, { type: "attach" });
    expect(result.effect).toEqual({ kind: "attach", sessionId: "s1" });
  });

  test("attach with nothing selected is a no-op", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    const result = dispatchCockpit(state, { type: "attach" });
    expect(result.effect).toBeUndefined();
  });

  test("refresh and quit emit their effects", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    expect(dispatchCockpit(state, { type: "refresh" }).effect).toEqual({
      kind: "refresh",
    });
    expect(dispatchCockpit(state, { type: "quit" }).effect).toEqual({
      kind: "quit",
    });
  });

  test("toggleHelp opens and closes the help overlay", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const opened = dispatchCockpit(state, { type: "toggleHelp" }).state;
    expect(opened.modal.kind).toBe("help");
    const closed = dispatchCockpit(opened, { type: "toggleHelp" }).state;
    expect(closed.modal.kind).toBe("none");
  });
});

describe("ephemeral badges in state", () => {
  test("a Message arriving via refresh badges a non-selected Session, and selecting it resets the badge", () => {
    const a = makeSession({ id: "a", createdAt: "2026-06-05T12:00:01.000Z" });
    const b = makeSession({ id: "b", createdAt: "2026-06-05T12:00:02.000Z" });
    // Start with no messages; baseline seeded empty.
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    expect(state.selectedSessionId).toBe("a");
    expect(badgeFor(state, "b")).toBe(0);

    // A new Message addressed to b arrives on refresh.
    const incoming = makeMessage({ id: "m1", toSessionId: "b" });
    state = applySnapshot(state, snapshot([a, b], [incoming]));
    // 'a' is selected on the Messages tab, so 'b' carries the new badge.
    expect(badgeFor(state, "b")).toBe(1);
    expect(badgeFor(state, "a")).toBe(0);

    // Selecting 'b' on the Messages tab observes it and clears the badge.
    state = dispatchCockpit(state, { type: "select", sessionId: "b" }).state;
    expect(badgeFor(state, "b")).toBe(0);
  });

  test("the currently-viewed Session never accrues a badge across refreshes", () => {
    const a = makeSession({ id: "a" });
    let state = createCockpitState(makeEnv(), snapshot([a]));
    const incoming = makeMessage({ id: "m1", toSessionId: "a" });
    state = applySnapshot(state, snapshot([a], [incoming]));
    // 'a' is selected on the Messages tab → auto-observed.
    expect(badgeFor(state, "a")).toBe(0);
  });

  test("badges are derived state only — the baseline is never written to the snapshot", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    const incoming = makeMessage({ id: "m1", toSessionId: "b" });
    state = applySnapshot(state, snapshot([a, b], [incoming]));
    // The Message row itself is untouched: no read/unread field exists on it.
    expect(state.snapshot.messages[0]).toEqual(incoming);
  });
});

describe("applySnapshot", () => {
  test("preserves the selected Session when it still exists", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    state = dispatchCockpit(state, { type: "select", sessionId: "b" }).state;
    state = applySnapshot(state, snapshot([a, b]));
    expect(state.selectedSessionId).toBe("b");
  });

  test("falls back to the first visible Session when the selection is gone", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    state = dispatchCockpit(state, { type: "select", sessionId: "b" }).state;
    state = applySnapshot(state, snapshot([a]));
    expect(state.selectedSessionId).toBe("a");
  });
});
