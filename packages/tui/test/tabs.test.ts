import { describe, expect, test } from "bun:test";
import { contextView, detailView } from "../src/index.ts";
import { makeEnv, makeSession, WORKTREE_A } from "./helpers.ts";

describe("detailView", () => {
  test("projects the documented Detail fields", () => {
    const session = makeSession({
      id: "s1",
      name: "reviewer-1",
      status: "running",
      agent: "claude",
      mux: "herdr",
      cwd: "/repo/a/sub",
      sessionDir: "/repo/a/.asem/sessions/s1",
      createdAt: "2026-06-05T12:00:00.000Z",
      updatedAt: "2026-06-05T12:30:00.000Z",
      closedAt: null,
    });

    const view = detailView(session, [session], "herdr attach w1:t1:p1");
    expect(view.id).toBe("s1");
    expect(view.name).toBe("reviewer-1");
    expect(view.status).toBe("running");
    expect(view.agent).toBe("claude");
    expect(view.mux).toBe("herdr");
    expect(view.model).toBeNull();
    expect(view.cwd).toBe("/repo/a/sub");
    expect(view.sessionDir).toBe("/repo/a/.asem/sessions/s1");
    expect(view.updatedAt).toBe("2026-06-05T12:30:00.000Z");
    expect(view.closedAt).toBeNull();
    expect(view.attachHint).toBe("herdr attach w1:t1:p1");
  });

  test("surfaces the launched model when present", () => {
    const session = makeSession({ id: "s1", model: "sonnet" });
    expect(detailView(session, [session]).model).toBe("sonnet");
  });

  test("surfaces the Agent Profile and source when present", () => {
    const session = makeSession({
      id: "s1",
      profile: "reviewer",
      profileSource: "project",
    });
    const view = detailView(session, [session]);
    expect(view.profile).toBe("reviewer");
    expect(view.profileSource).toBe("project");
  });

  test("profile/profileSource are null when no profile was selected", () => {
    const view = detailView(makeSession({ id: "s1" }), []);
    expect(view.profile).toBeNull();
    expect(view.profileSource).toBeNull();
  });

  test("resolves the parent label to the parent name when in scope", () => {
    const parent = makeSession({ id: "p", name: "parent" });
    const child = makeSession({ id: "c", parentSessionId: "p" });
    const view = detailView(child, [parent, child]);
    expect(view.parentLabel).toBe("parent");
    expect(view.parentSessionId).toBe("p");
  });

  test("falls back to the parent id, then '-', when not resolvable", () => {
    const child = makeSession({ id: "c", parentSessionId: "ghost" });
    expect(detailView(child, [child]).parentLabel).toBe("ghost");

    const root = makeSession({ id: "r", parentSessionId: null });
    expect(detailView(root, [root]).parentLabel).toBe("-");
  });
});

describe("contextView", () => {
  test("projects scope, config defaults, and the selected mux-ref summary", () => {
    const env = makeEnv();
    const selected = makeSession({
      muxRef: { workspace: "w1", tab: "t1", pane: "p1" },
    });

    const view = contextView(env, selected);
    expect(view.workspaceId).toBe(env.workspaceId);
    expect(view.worktreeRoot).toBe(WORKTREE_A);
    expect(view.cwd).toBe(env.cwd);
    expect(view.configPath).toBe(env.configPath);
    expect(view.defaultMux).toBe("herdr");
    expect(view.defaultAgent).toBe("claude");
    expect(view.selectedMuxRefSummary).toBe("pane=p1, tab=t1, workspace=w1");
  });

  test("mux-ref summary is null when nothing is selected", () => {
    expect(contextView(makeEnv(), null).selectedMuxRefSummary).toBeNull();
  });
});
