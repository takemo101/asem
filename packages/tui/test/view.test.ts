import { describe, expect, test } from "bun:test";
import type { CockpitSnapshot, LeftRow } from "../src/index.ts";
import {
  applySnapshot,
  createCockpitState,
  dispatchCockpit,
  renderCockpitView,
  STATUS_SYMBOLS,
} from "../src/index.ts";
import { makeEnv, makeMessage, makeSession } from "./helpers.ts";

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

function present<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  if (value === null || value === undefined) {
    throw new Error("expected value to be present");
  }
  return value;
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
    expect(present(rows[0]).symbol).toBe(STATUS_SYMBOLS.running);
    expect(present(rows[1]).symbol).toBe(STATUS_SYMBOLS.exited);
    expect(present(rows[1]).depth).toBe(1);
    // First visible row is selected by default.
    expect(present(rows[0]).selected).toBe(true);
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

  test("workspace scope renders one Workspace tree with per-row location and no worktree group headers", () => {
    const root = makeSession({
      id: "root",
      name: "root",
      worktreeRoot: "/workspace",
    });
    const frontend = makeSession({
      id: "fe",
      name: "frontend-parent",
      worktreeRoot: "/workspace/frontend",
      parentSessionId: "root",
    });
    const state = createCockpitState(
      makeEnv({ scopeMode: "workspace", worktreeRoot: "/workspace" }),
      snapshot([root, frontend]),
    );
    const view = renderCockpitView(state);

    // Global tree + repo badges: no worktree group headers.
    expect(view.left.rows.some((r) => r.kind === "group")).toBe(false);

    const rows = sessionRows(view.left.rows);
    expect(rows.map((r) => r.name)).toEqual(["root", "frontend-parent"]);
    const child = present(rows.find((r) => r.sessionId === "fe"));
    expect(child.depth).toBe(1);
    // Each row exposes its own location so root vs repo Sessions are distinct.
    expect(child.location).toBe("/workspace/frontend");
    expect(present(rows.find((r) => r.sessionId === "root")).location).toBe(
      "/workspace",
    );
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
      "model:",
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
    // No model selected → rendered as a dash.
    expect(text).toContain("model:         -");
  });

  test("Detail tab shows the launched model when present", () => {
    const s = makeSession({ id: "s1", name: "one", model: "sonnet" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;
    const text = renderCockpitView(state).right.join("\n");
    expect(text).toContain("model:         sonnet");
  });

  test("Detail tab shows profile metadata only when a profile is present", () => {
    const withProfile = makeSession({
      id: "s1",
      name: "one",
      profile: "reviewer",
      profileSource: "builtin",
    });
    let state = createCockpitState(makeEnv(), snapshot([withProfile]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;
    const text = renderCockpitView(state).right.join("\n");
    expect(text).toContain("profile:       reviewer");
    expect(text).toContain("profile_src:   builtin");

    // No profile → the profile lines are omitted entirely.
    const noProfile = makeSession({ id: "s2", name: "two" });
    let bare = createCockpitState(makeEnv(), snapshot([noProfile]));
    bare = dispatchCockpit(bare, { type: "setTab", tab: "detail" }).state;
    expect(renderCockpitView(bare).right.join("\n")).not.toContain("profile:");
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

  test("Context tab shows the Workspace relationship card for a repo parent Session", () => {
    const root = makeSession({
      id: "root",
      name: "root",
      worktreeRoot: "/workspace",
    });
    const frontend = makeSession({
      id: "fe",
      name: "frontend-parent",
      worktreeRoot: "/workspace/frontend",
      parentSessionId: "root",
    });
    const backend = makeSession({
      id: "be",
      name: "backend-parent",
      worktreeRoot: "/workspace/backend",
      parentSessionId: "root",
    });
    let state = createCockpitState(
      makeEnv({ scopeMode: "workspace", worktreeRoot: "/workspace" }),
      snapshot([root, frontend, backend]),
    );
    state = dispatchCockpit(state, { type: "select", sessionId: "fe" }).state;
    state = dispatchCockpit(state, { type: "setTab", tab: "context" }).state;
    const text = renderCockpitView(state).right.join("\n");

    expect(text).toContain("relationship:");
    // Parent name/id and parent location when present.
    expect(text).toContain("root");
    expect(text).toContain("/workspace");
    // Current Session location.
    expect(text).toContain("/workspace/frontend");
    // Sibling/related Sessions under the same parent.
    expect(text).toContain("backend-parent");
    // Parent/report semantics are same-Workspace.
    expect(text.toLowerCase()).toContain("workspace");
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

  test("notice is projected as typed transient feedback", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    const view = renderCockpitView(state, {
      notice: { level: "error", message: "boom", code: "timeout" },
    });

    expect(view.notice).toEqual({
      level: "error",
      message: "boom",
      code: "timeout",
    });
  });
});
