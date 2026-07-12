import { describe, expect, test } from "bun:test";
import type { CockpitSnapshot, LeftRow } from "../src/index.ts";
import {
  applySnapshot,
  createCockpitState,
  dispatchCockpit,
  relativeUpdatedLabel,
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

  test("Messages tab renders ledger entries with time, direction, kind, and counterpart", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const parent = makeSession({ id: "p", name: "parent" });
    const incoming = makeMessage({
      id: "m1",
      fromSessionId: "p",
      toSessionId: "s1",
      body: "hi",
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const outgoing = makeMessage({
      id: "m2",
      fromSessionId: "s1",
      toSessionId: "p",
      kind: "report",
      body: "done",
      createdAt: "2026-06-05T12:05:00.000Z",
    });
    let state = createCockpitState(
      makeEnv(),
      snapshot([s, parent], [incoming, outgoing]),
    );
    state = dispatchCockpit(state, { type: "select", sessionId: "s1" }).state;
    const text = renderCockpitView(state).right.join("\n");

    expect(text).toMatch(/12:00 IN {2}message · parent/);
    expect(text).toMatch(/12:05 OUT report · parent/);
  });

  test("entries are separated by a restrained rule", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const first = makeMessage({
      id: "m1",
      toSessionId: "s1",
      body: "one",
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const second = makeMessage({
      id: "m2",
      toSessionId: "s1",
      body: "two",
      createdAt: "2026-06-05T12:01:00.000Z",
    });
    const state = createCockpitState(makeEnv(), snapshot([s], [first, second]));
    const view = renderCockpitView(state);

    const ruleIndex = view.right.indexOf("────────");
    expect(ruleIndex).toBeGreaterThan(0);
    // Exactly one rule between the two entries, none trailing.
    expect(view.right.filter((l) => l === "────────")).toHaveLength(1);
    expect(view.right.at(-1)).not.toBe("────────");
  });

  test("report bodies are expanded; ordinary Messages preview until expanded", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const report = makeMessage({
      id: "r1",
      toSessionId: "s1",
      kind: "report",
      body: "line1\nline2",
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const ordinary = makeMessage({
      id: "m1",
      toSessionId: "s1",
      body: "first\nsecond",
      createdAt: "2026-06-05T12:01:00.000Z",
    });
    const state = createCockpitState(
      makeEnv(),
      snapshot([s], [report, ordinary]),
    );

    const collapsed = renderCockpitView(state).right.join("\n");
    // Report body fully expanded by default.
    expect(collapsed).toContain("  line1");
    expect(collapsed).toContain("  line2");
    // Ordinary Message shows a one-line preview only.
    expect(collapsed).toContain("  first…");
    expect(collapsed).not.toContain("second");

    // Expansion is ephemeral local UI state passed at render time.
    const expanded = renderCockpitView(state, {
      expandedMessageIds: new Set(["m1"]),
    }).right.join("\n");
    expect(expanded).toContain("  second");
  });

  test("ordinary Message bodies are reachable at runtime via toggleExpand", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const ordinary = makeMessage({
      id: "m1",
      toSessionId: "s1",
      body: "first\nsecond",
    });
    let state = createCockpitState(makeEnv(), snapshot([s], [ordinary]));

    // No render options: the live hosts render straight from state.
    expect(renderCockpitView(state).right.join("\n")).not.toContain("second");
    state = dispatchCockpit(state, { type: "toggleExpand" }).state;
    expect(renderCockpitView(state).right.join("\n")).toContain("  second");
    state = dispatchCockpit(state, { type: "toggleExpand" }).state;
    expect(renderCockpitView(state).right.join("\n")).not.toContain("second");
  });

  test("a failed notification renders the durable notice verbatim", () => {
    const s = makeSession({ id: "s1", name: "one" });
    const failed = makeMessage({
      id: "m2",
      toSessionId: "s1",
      body: "oops",
      deliveryError: "pane gone",
    });
    const state = createCockpitState(makeEnv(), snapshot([s], [failed]));
    const text = renderCockpitView(state).right.join("\n");

    expect(text).toContain(
      "Notification failed · Message is stored · no auto-resend",
    );
    // The notice never implies loss, acknowledgement, or a resend action.
    expect(text).not.toContain("undelivered");
    expect(text).not.toContain("retry");
  });

  test("Detail tab renders the operational summary in decision order", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;
    const lines = renderCockpitView(state).right;
    const text = lines.join("\n");

    // Section headings, in operator-decision order.
    const sessionAt = lines.indexOf("Session");
    const locationAt = lines.indexOf("Location");
    const lifecycleAt = lines.indexOf("Lifecycle");
    const technicalAt = lines.findIndex((l) => l.startsWith("Technical"));
    expect(sessionAt).toBe(0);
    expect(locationAt).toBeGreaterThan(sessionAt);
    expect(lifecycleAt).toBeGreaterThan(locationAt);
    expect(technicalAt).toBeGreaterThan(lifecycleAt);

    for (const field of [
      "status:",
      "name:",
      "agent:",
      "mux:",
      "model:",
      "parent:",
      "cwd:",
      "worktree_root:",
      "created_at:",
      "updated_at:",
      "closed_at:",
    ]) {
      expect(text).toContain(field);
    }
    // No model selected → rendered as a dash.
    expect(text).toContain("model:         -");
  });

  test("Detail tab collapses Technical by default and expands on request", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;

    const collapsed = renderCockpitView(state, {
      attachHint: "herdr attach w1:t1:p1",
    }).right.join("\n");
    // Technical data does not dominate the default view.
    expect(collapsed).toContain("Technical ▸");
    expect(collapsed).not.toContain("id:");
    expect(collapsed).not.toContain("session_dir:");
    expect(collapsed).not.toContain("mux_ref:");
    expect(collapsed).not.toContain("attach_hint:");

    const expanded = renderCockpitView(state, {
      attachHint: "herdr attach w1:t1:p1",
      technicalExpanded: true,
    }).right.join("\n");
    // Everything remains available: id, runtime dir, mux coordinates, hint.
    expect(expanded).toContain("id:            s1");
    expect(expanded).toContain("session_dir:");
    expect(expanded).toContain("mux_ref:");
    expect(expanded).toContain("attach_hint:   herdr attach w1:t1:p1");
  });

  test("Technical details are reachable at runtime via toggleExpand", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;

    // No render options: the live hosts render straight from state.
    expect(renderCockpitView(state).right.join("\n")).toContain("Technical ▸");
    state = dispatchCockpit(state, { type: "toggleExpand" }).state;
    const expanded = renderCockpitView(state).right.join("\n");
    expect(expanded).toContain("id:            s1");
    expect(expanded).toContain("session_dir:");
    state = dispatchCockpit(state, { type: "toggleExpand" }).state;
    expect(renderCockpitView(state).right.join("\n")).toContain("Technical ▸");
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
    expect(text).toContain("profile:       reviewer (builtin)");

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

  test("Context tab renders the relationship card ordered parent → selected → children", () => {
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
    const leaf = makeSession({
      id: "lf",
      name: "leaf-worker",
      worktreeRoot: "/workspace/frontend",
      parentSessionId: "fe",
    });
    let state = createCockpitState(
      makeEnv({ scopeMode: "workspace", worktreeRoot: "/workspace" }),
      snapshot([root, frontend, leaf]),
    );
    state = dispatchCockpit(state, { type: "select", sessionId: "fe" }).state;
    state = dispatchCockpit(state, { type: "setTab", tab: "context" }).state;
    const lines = renderCockpitView(state).right;
    const text = lines.join("\n");

    // Relationship card first; Workspace/location metadata separated below.
    const relationshipAt = lines.indexOf("Relationship");
    const workspaceAt = lines.indexOf("Workspace");
    expect(relationshipAt).toBe(0);
    expect(workspaceAt).toBeGreaterThan(relationshipAt);

    const parentAt = lines.findIndex((l) => l.includes("parent:"));
    const selectedAt = lines.findIndex((l) => l.includes("selected:"));
    const childrenAt = lines.findIndex((l) => l.includes("children:"));
    expect(parentAt).toBeGreaterThan(relationshipAt);
    expect(selectedAt).toBeGreaterThan(parentAt);
    expect(childrenAt).toBeGreaterThan(selectedAt);
    expect(childrenAt).toBeLessThan(workspaceAt);

    // Parent, selected, and children resolve names and locations.
    expect(lines[parentAt]).toContain("root");
    expect(lines[selectedAt]).toContain("frontend-parent");
    expect(lines[selectedAt]).toContain("@/workspace/frontend");
    expect(lines[childrenAt]).toContain("leaf-worker");
    // Workspace metadata lives in its own section, after the card.
    expect(lines.indexOf("  workspace_id:  ws_1")).toBeGreaterThan(workspaceAt);
    // Parent/report semantics are same-Workspace.
    expect(text.toLowerCase()).toContain("workspace");
  });

  test("Context is read-first: no inline action hints", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "context" }).state;
    const text = renderCockpitView(state).right.join("\n");

    // Attach/send/close/delete stay on the global keybar, never in Context.
    for (const hint of ["attach", "send", "close", "delete", "[a]", "[s]"]) {
      expect(text).not.toContain(hint);
    }
  });

  test("empty / no-selection panes render placeholders", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    expect(renderCockpitView(state).right).toEqual(["(no messages)"]);
  });

  test("narrow widths keep Detail sections as one vertical stack, nothing removed", () => {
    const s = makeSession({ id: "s1", name: "one" });
    let state = createCockpitState(makeEnv(), snapshot([s]));
    state = dispatchCockpit(state, { type: "setTab", tab: "detail" }).state;
    const lines = renderCockpitView(state).right;

    // The view layer emits a single-column stack independent of any width:
    // every section heading and field is its own line, so narrow terminals
    // stack sections vertically without dropping information.
    for (const line of ["Session", "Location", "Lifecycle"]) {
      expect(lines).toContain(line);
    }
    expect(lines.filter((l) => l.includes("status:"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("cwd:"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("created_at:"))).toHaveLength(1);
  });
});

describe("dossier header", () => {
  test("exposes status, name, agent, mux, profile, and relative update label", () => {
    const s = makeSession({
      id: "s1",
      name: "one",
      status: "running",
      agent: "claude",
      mux: "herdr",
      profile: "reviewer",
      updatedAt: "2026-06-05T12:00:00.000Z",
    });
    const state = createCockpitState(makeEnv(), snapshot([s]));
    const view = renderCockpitView(state, {
      now: "2026-06-05T12:05:00.000Z",
    });

    expect(view.dossier).toEqual({
      status: "running",
      symbol: STATUS_SYMBOLS.running,
      name: "one",
      agent: "claude",
      mux: "herdr",
      profile: "reviewer",
      updatedLabel: "updated 5m ago",
    });
  });

  test("profile is null when the Session has none", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    expect(renderCockpitView(state).dossier?.profile).toBeNull();
  });

  test("dossier is null when no Session is selected", () => {
    const state = createCockpitState(makeEnv(), snapshot([]));
    expect(renderCockpitView(state).dossier).toBeNull();
  });

  test("relative update labels cover seconds, hours, days, and the no-clock fallback", () => {
    expect(
      relativeUpdatedLabel(
        "2026-06-05T12:00:00.000Z",
        "2026-06-05T12:00:30.000Z",
      ),
    ).toBe("updated just now");
    expect(
      relativeUpdatedLabel(
        "2026-06-05T12:00:00.000Z",
        "2026-06-05T15:00:00.000Z",
      ),
    ).toBe("updated 3h ago");
    expect(
      relativeUpdatedLabel(
        "2026-06-05T12:00:00.000Z",
        "2026-06-08T12:00:00.000Z",
      ),
    ).toBe("updated 3d ago");
    // Without an injected clock the raw timestamp is shown verbatim.
    expect(relativeUpdatedLabel("2026-06-05T12:00:00.000Z", null)).toBe(
      "updated 2026-06-05T12:00:00.000Z",
    );
  });
});

describe("keybar and modals", () => {
  test("keybar exposes all required affordances", () => {
    const state = createCockpitState(makeEnv(), snapshot([makeSession()]));
    const labels = renderCockpitView(state).keybar.map((k) => k.label);
    for (const label of [
      "select",
      "switch",
      "expand",
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
    expect(modal?.lines.join("\n")).toContain("expand");
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
