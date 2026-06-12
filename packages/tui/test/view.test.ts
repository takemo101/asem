import { describe, expect, test } from "bun:test";
import type { CockpitSnapshot, LeftRow } from "../src/index.ts";
import {
  applySnapshot,
  createCockpitState,
  dispatchCockpit,
  renderCockpitView,
  STATUS_SYMBOLS,
} from "../src/index.ts";
import {
  makeEnv,
  makeMessage,
  makeSession,
  WORKTREE_A,
  WORKTREE_B,
} from "./helpers.ts";

function snapshot(
  sessions: ReturnType<typeof makeSession>[],
  messages: ReturnType<typeof makeMessage>[] = [],
): CockpitSnapshot {
  return { sessions, messages };
}

function sessionRows(rows: LeftRow[]) {
  return rows.filter(
    (r): r is Extract<LeftRow, { kind: "session" }> => r.kind === "session",
  );
}

describe("left pane", () => {
  test("renders status symbols, selection, and depth for the hierarchy", () => {
    const parent = makeSession({ id: "p", name: "parent", status: "running" });
    const child = makeSession({
      id: "c",
      name: "child",
      status: "exited",
      parentSessionId: "p",
    });
    const state = createCockpitState(makeEnv(), snapshot([parent, child]));
    const view = renderCockpitView(state);

    const rows = sessionRows(view.left.rows);
    expect(rows.map((r) => r.name)).toEqual(["parent", "child"]);
    expect(rows[0]!.symbol).toBe(STATUS_SYMBOLS.running);
    expect(rows[1]!.symbol).toBe(STATUS_SYMBOLS.exited);
    expect(rows[1]!.depth).toBe(1);
    // First visible row is selected by default.
    expect(rows[0]!.selected).toBe(true);
    expect(view.left.scopeLabel).toBe("scope: worktree");
  });

  test("covers every status symbol", () => {
    expect(STATUS_SYMBOLS).toEqual({
      starting: "…",
      running: "●",
      exited: "○",
      missing: "!",
      closed: "×",
    });
  });

  test("workspace scope inserts a group header per worktree root", () => {
    const a = makeSession({ id: "a", worktreeRoot: WORKTREE_A });
    const b = makeSession({ id: "b", worktreeRoot: WORKTREE_B });
    const state = createCockpitState(
      makeEnv({ scopeMode: "workspace" }),
      snapshot([a, b]),
    );
    const view = renderCockpitView(state);
    const groups = view.left.rows.filter((r) => r.kind === "group");
    expect(groups).toEqual([
      { kind: "group", worktreeRoot: WORKTREE_A },
      { kind: "group", worktreeRoot: WORKTREE_B },
    ]);
  });

  test("badges surface ephemeral new-message counts", () => {
    const a = makeSession({ id: "a" });
    const b = makeSession({ id: "b" });
    let state = createCockpitState(makeEnv(), snapshot([a, b]));
    state = applySnapshot(
      state,
      snapshot([a, b], [makeMessage({ id: "m1", toSessionId: "b" })]),
    );
    const rows = sessionRows(renderCockpitView(state).left.rows);
    expect(rows.find((r) => r.sessionId === "b")?.badge).toBe(1);
  });
});

describe("tabs and right pane", () => {
  test("tab headers mark the active tab", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const view = renderCockpitView(state);
    expect(view.tabs.map((t) => t.title)).toEqual([
      "Messages",
      "Detail",
      "Context",
    ]);
    expect(view.tabs.find((t) => t.active)?.tab).toBe("messages");
  });

  test("Messages tab lists related messages with an undelivered marker", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const ok = makeMessage({
      id: "m1",
      toSessionId: "s1",
      body: "hi",
      deliveredAt: "2026-06-05T12:00:00.000Z",
    });
    const failed = makeMessage({
      id: "m2",
      toSessionId: "s1",
      body: "oops",
      deliveryError: "pane gone",
    });
    const state = createCockpitState(makeEnv(), snapshot([s], [ok, failed]));
    const view = renderCockpitView(state);
    expect(view.right[0]).toContain("hi");
    expect(view.right[1]).toContain("! undelivered");
  });

  test("Detail tab lists the documented fields", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;
    const text = renderCockpitView(state).right.join("\n");
    for (const field of [
      "id:",
      "name:",
      "status:",
      "agent:",
      "mux:",
      "parent:",
      "cwd:",
      "worktree_root:",
      "session_dir:",
      "created_at:",
      "updated_at:",
      "closed_at:",
      "attach_hint:",
    ]) {
      expect(text).toContain(field);
    }
  });

  test("Context tab lists scope, config path, and defaults", () => {
    const s = makeSession({ id: "s1", muxRef: { pane: "p9" } });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "context" }).state;
    const text = renderCockpitView(state).right.join("\n");
    expect(text).toContain("workspace_id:");
    expect(text).toContain("config:");
    expect(text).toContain("default_mux:");
    expect(text).toContain("pane=p9");
  });

  test("empty / no-selection panes render placeholders", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    expect(renderCockpitView(state).right).toEqual(["(no messages)"]);
  });
});

describe("keybar and modals", () => {
  test("keybar exposes all required affordances", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const labels = renderCockpitView(state).keybar.map((k) => k.label);
    for (const label of [
      "select",
      "switch",
      "attach",
      "send",
      "close",
      "delete",
      "refresh",
      "filter",
      "help",
      "quit",
    ]) {
      expect(labels).toContain(label);
    }
  });

  test("send modal projects the draft as lines with a send/cancel hint", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "openSend" }).state;
    state = dispatchCockpit(state, {
      type: "updateDraft",
      draft: "line1\nline2",
    }).state;
    const modal = renderCockpitView(state).modal;
    expect(modal?.kind).toBe("send");
    expect(modal?.lines).toEqual(["line1", "line2"]);
    expect(modal?.hint).toContain("Ctrl+Enter");
  });

  test("confirm modal names the action and target", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "requestDelete" }).state;
    const modal = renderCockpitView(state).modal;
    expect(modal?.kind).toBe("confirm");
    expect(modal?.lines[0]).toContain("Delete one");
  });

  test("help modal lists keybindings", () => {
    let state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    state = dispatchCockpit(state, { type: "toggleHelp" }).state;
    const modal = renderCockpitView(state).modal;
    expect(modal?.kind).toBe("help");
    expect(modal?.lines.join("\n")).toContain("attach");
  });

  test("error modal projects the failure with a dismiss hint", () => {
    let state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    state = dispatchCockpit(state, {
      type: "showError",
      code: "session_not_found",
      message: "line one\nline two",
    }).state;
    const modal = renderCockpitView(state).modal;
    expect(modal?.kind).toBe("error");
    expect(modal?.title).toBe("Operation failed");
    expect(modal?.lines.join("\n")).toContain("session_not_found");
    expect(modal?.lines).toContain("line one");
    expect(modal?.lines).toContain("line two");
    expect(modal?.hint).toContain("Esc");
  });

  test("error modal caps a long message to a small overlay", () => {
    const message = Array.from({ length: 30 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    let state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    state = dispatchCockpit(state, {
      type: "showError",
      code: "timeout",
      message,
    }).state;
    const modal = renderCockpitView(state).modal;
    expect(modal?.lines.length).toBeLessThanOrEqual(10);
    expect(modal?.lines.at(-1)).toBe("…");
  });

  test("statusLine is passed through", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    expect(renderCockpitView(state, { statusLine: "done" }).statusLine).toBe(
      "done",
    );
  });
});
