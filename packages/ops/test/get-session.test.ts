import { describe, expect, test } from "bun:test";
import type { ConfigDiscovery } from "@asem/core";
import { getSession } from "../src/index.ts";
import {
  FakeConfigLoader,
  FakeLivenessProbe,
  FakeScopeResolver,
  FakeStore,
  makeConfig,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import { expectErr, expectOk, makeSession, scopeA, scopeB } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };

function depsWith(store: FakeStore, overrides = {}) {
  return makeOpsDeps({
    store,
    scopeResolver: new FakeScopeResolver(scopeA),
    ...overrides,
  });
}

describe("getSession", () => {
  test("reads a Session in the current scope", async () => {
    const store = new FakeStore();
    const s = makeSession({ name: "reviewer" });
    store.sessions.push(s);

    const { session } = expectOk(
      await getSession(depsWith(store), { id: s.id }, CTX),
    );
    expect(session.id).toBe(s.id);
    expect(session.name).toBe("reviewer");
  });

  test("reports a Session in a sibling worktree as session_not_found", async () => {
    const store = new FakeStore();
    // Registered in scopeB; the lookup runs in scopeA → must not leak (ADR 0002).
    const other = makeSession({
      name: "b",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
    });
    store.sessions.push(other);

    expectErr(
      await getSession(depsWith(store), { id: other.id }, CTX),
      "session_not_found",
    );
  });

  test("returns session_not_found for an unknown id", async () => {
    const store = new FakeStore();
    expectErr(
      await getSession(depsWith(store), { id: "nope" }, CTX),
      "session_not_found",
    );
  });

  test("does not probe liveness unless asked", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);
    const probe = new FakeLivenessProbe();

    expectOk(
      await getSession(
        depsWith(store, { livenessProbe: probe }),
        { id: s.id },
        CTX,
      ),
    );
    expect(probe.probed).toHaveLength(0);
  });

  test("refreshLiveness updates the stored status from the probe", async () => {
    const store = new FakeStore();
    const s = makeSession({ status: "running" });
    store.sessions.push(s);

    const probe = new FakeLivenessProbe();
    probe.set(s.id, "exited");

    const { session } = expectOk(
      await getSession(
        depsWith(store, { livenessProbe: probe }),
        { id: s.id },
        { cwd: scopeA.worktreeRoot, refreshLiveness: true },
      ),
    );
    expect(probe.probed).toEqual([s.id]);
    expect(session.status).toBe("exited");
    const stored = await store.getSessionById(scopeA, s.id);
    expect(stored!.status).toBe("exited");
  });

  describe("attach hint", () => {
    test("surfaces the herdr attach command from the captured mux ref", async () => {
      const store = new FakeStore();
      const s = makeSession({ mux: "herdr", muxRef: { pane_id: "w-7" } });
      store.sessions.push(s);

      const result = expectOk(
        await getSession(depsWith(store), { id: s.id }, CTX),
      );
      expect(result.attachHint).toBe("herdr agent attach 'w-7'");
    });

    test("surfaces the tmux multi-step attach as one line", async () => {
      const store = new FakeStore();
      const s = makeSession({
        mux: "tmux",
        muxRef: { session_name: "main", window_id: "@1", pane_id: "%2" },
      });
      store.sessions.push(s);

      const result = expectOk(
        await getSession(depsWith(store), { id: s.id }, CTX),
      );
      expect(result.attachHint).toBe(
        "tmux select-window -t '@1' && tmux select-pane -t '%2' && tmux attach-session -t 'main'",
      );
    });

    test("omits the hint when the captured mux ref is incomplete", async () => {
      const store = new FakeStore();
      // herdr's attach references `pane_id`, which this ref lacks → no hint.
      const s = makeSession({ mux: "herdr", muxRef: { tab_id: "t-1" } });
      store.sessions.push(s);

      const result = expectOk(
        await getSession(depsWith(store), { id: s.id }, CTX),
      );
      expect(result.attachHint).toBeUndefined();
    });

    test("omits the hint when the mux template is unknown", async () => {
      const store = new FakeStore();
      const s = makeSession({ mux: "no-such-mux", muxRef: { pane_id: "w-7" } });
      store.sessions.push(s);

      const result = expectOk(
        await getSession(depsWith(store), { id: s.id }, CTX),
      );
      expect(result.attachHint).toBeUndefined();
    });

    test("a malformed project-local mux template returns invalid_template, not a thrown defect", async () => {
      const store = new FakeStore();
      const s = makeSession({ mux: "herdr", muxRef: { pane_id: "w-7" } });
      store.sessions.push(s);
      const config = makeConfig({
        mux: {
          default: "herdr",
          templates: { herdr: { attach: [{ type: "unknown_step" }] } },
        },
      });
      const deps = depsWith(store, {
        configLoader: new FakeConfigLoader({
          kind: "found",
          config,
          configPath: "/repo/.asem.yaml",
        } satisfies ConfigDiscovery),
      });

      const error = expectErr(
        await getSession(deps, { id: s.id }, CTX),
        "invalid_template",
      );
      expect(error.details?.kind).toBe("mux");
      expect(error.details?.name).toBe("herdr");
    });
  });
});
