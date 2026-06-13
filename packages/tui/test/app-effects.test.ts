import { describe, expect, test } from "bun:test";
import {
  FakeStore,
  MemoryLogger,
  makeOpsDeps,
} from "../../ops/src/testing/fakes.ts";
import { CockpitApp, createCockpitState } from "../src/index.ts";
import { makeApp, snapshot } from "./app-helpers.ts";
import { FakeHost, makeEnv, makeSession } from "./helpers.ts";

describe("CockpitApp effects", () => {
  test("manual refresh sets an info notice", async () => {
    const store = new FakeStore();
    const { app } = makeApp({ store });

    const result = await app.dispatch({ type: "refresh" });

    expect(result.error).toBeUndefined();
    expect(app.view().notice).toEqual({ level: "info", message: "refreshed" });
  });

  test("send success sets a success notice", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app } = makeApp({ store });

    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "ping" });
    const result = await app.dispatch({ type: "submitSend" });

    expect(result.error).toBeUndefined();
    expect(app.view().notice).toEqual({
      level: "success",
      message: "sent message to s1",
    });
  });

  test("a manual refresh success clears a lingering error notice", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });

    // Seed an error notice through the non-modal refresh path: an operation
    // error while a modal is open degrades to a notice rather than a modal.
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "keep" });
    app.reportOperationError({
      code: "message_delivery_failed",
      message: "network hiccup",
    });
    expect(app.view().notice).toEqual({
      level: "error",
      code: "message_delivery_failed",
      message: "network hiccup",
    });

    const result = await app.dispatch({ type: "refresh" });

    expect(result.error).toBeUndefined();
    expect(app.view().notice).toEqual({ level: "info", message: "refreshed" });
  });

  test("an auto-refresh error notice is cleared by a later successful tick", async () => {
    const { FakeConfigLoader, makeConfig } = await import(
      "../../ops/src/testing/fakes.ts"
    );
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const configLoader = new FakeConfigLoader({ kind: "not_found" });
    const deps = makeOpsDeps({ store, configLoader });

    // First tick fails (config missing) → error notice; the second tick runs
    // after config is restored, so the refresh succeeds and clears the error.
    class TogglingHost extends FakeHost {
      ticks = 0;
      override nextKeyOrTick(timeoutMs: number) {
        this.ticks += 1;
        if (this.ticks === 2) {
          configLoader.result = {
            kind: "found",
            config: makeConfig(),
            configPath: "/repo/.asem.yaml",
          };
        }
        return super.nextKeyOrTick(timeoutMs);
      }
    }
    const host = new TogglingHost(["tick", "tick", null]);
    const app = new CockpitApp(deps, env, state, host);

    await app.run();

    const last = host.lastFrame();
    expect(last?.notice).toBeNull();
  });

  test("send dispatches send_message and refreshes", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app } = makeApp({ store });

    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "ping" });
    const result = await app.dispatch({ type: "submitSend" });

    expect(result.error).toBeUndefined();
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.body).toBe("ping");
    // The refreshed snapshot now carries the new Message.
    expect(app.state.snapshot.messages.map((m) => m.body)).toEqual(["ping"]);
  });

  test("confirmed delete removes the Session and reselects", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "a", name: "a" }),
      makeSession({ id: "b", name: "b", status: "closed" }),
    );
    const { app } = makeApp({ store });

    await app.dispatch({ type: "select", sessionId: "b" });
    await app.dispatch({ type: "requestDelete" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions.map((s) => s.id)).toEqual(["a"]);
    // 'b' is gone, so selection falls back to the remaining Session.
    expect(app.state.selectedSessionId).toBe("a");
  });

  test("close dispatches close_session", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1", status: "running" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestClose" });
    await app.dispatch({ type: "confirm" });
    expect(store.sessions[0]!.status).toBe("closed");
  });

  test("close uses the provided deps logger; surface composition supplies the TUI-safe logger", async () => {
    const store = new FakeStore();
    const logger = new MemoryLogger();
    store.sessions.push(makeSession({ id: "s1", status: "running" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const app = new CockpitApp(
      makeOpsDeps({ store, logger }),
      env,
      state,
      new FakeHost(),
    );

    await app.dispatch({ type: "requestClose" });
    const result = await app.dispatch({ type: "confirm" });

    expect(result.error).toBeUndefined();
    expect(store.sessions[0]!.status).toBe("closed");
    expect(
      logger.entries.some((entry) => entry.message === "closed Session"),
    ).toBe(true);
  });

  test("attach leaves to the host with the get_session hint and refreshes", async () => {
    const store = new FakeStore();
    // The default muxRef carries herdr session/workspace/tab refs, so attach
    // can be represented as structured argv instead of a shell-only hint.
    store.sessions.push(makeSession({ id: "s1", name: "one" }));
    const { app, host } = makeApp({ store });
    await app.dispatch({ type: "attach" });
    expect(host.attaches).toHaveLength(1);
    expect(host.attaches[0]!.session.id).toBe("s1");
    expect(host.attaches[0]!.attachHint).toContain("herdr --session 'asem'");
    expect(host.attaches[0]!.attachCommand).toEqual({
      argv: [
        "sh",
        "-c",
        "herdr --session 'asem' workspace focus 'ws_1' >/dev/null && herdr --session 'asem' tab focus 'tab-1' >/dev/null && if [ \"${HERDR_ENV:-}\" = '1' ]; then :; else exec herdr session attach 'asem'; fi",
      ],
    });
  });

  test("attach on a closed Session opens an error modal and does not call the host", async () => {
    const store = new FakeStore();
    store.sessions.push(
      makeSession({ id: "s1", name: "one", status: "closed" }),
    );
    const { app, host } = makeApp({ store });

    const result = await app.dispatch({ type: "attach" });

    expect(result.effect).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(host.attaches).toEqual([]);
    expect(app.state.modal).toEqual({
      kind: "error",
      code: "session_closed",
      message: "closed Sessions cannot be attached",
    });
  });

  test("attach passes a null hint when the mux ref cannot render one", async () => {
    const store = new FakeStore();
    // herdr's attach references session/workspace/tab refs, which this ref lacks → no hint.
    store.sessions.push(
      makeSession({ id: "s1", name: "one", muxRef: { tab_id: "tab-1" } }),
    );
    const { app, host } = makeApp({ store });
    await app.dispatch({ type: "attach" });
    expect(host.attaches).toHaveLength(1);
    expect(host.attaches[0]!.attachHint).toBeNull();
    expect(host.attaches[0]!.attachCommand).toBeNull();
  });

  test("a failing close opens the error modal instead of a notice", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    // Delete the row out from under the app, then confirm a close on it.
    await app.dispatch({ type: "requestClose" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "confirm" });
    expect(result.error?.code).toBe("session_not_found");
    const view = app.view();
    expect(view.modal?.kind).toBe("error");
    expect(view.modal?.title).toBe("Operation failed");
    expect(view.modal?.lines.join("\n")).toContain("session_not_found");
    expect(view.notice).toBeNull();
  });

  test("a failing delete opens the error modal", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestDelete" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "confirm" });
    expect(result.error?.code).toBe("session_not_found");
    expect(app.state.modal.kind).toBe("error");
    expect(app.view().notice).toBeNull();
  });

  test("a failing send opens the error modal", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "ping" });
    store.sessions.length = 0;
    const result = await app.dispatch({ type: "submitSend" });
    expect(result.error?.code).toBe("session_not_found");
    expect(app.state.modal.kind).toBe("error");
    expect(app.view().notice).toBeNull();
  });

  test("dismissing the error modal returns to the normal cockpit", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "requestClose" });
    store.sessions.length = 0;
    await app.dispatch({ type: "confirm" });
    expect(app.state.modal.kind).toBe("error");
    // q dismisses the modal instead of quitting.
    await app.handleKey({ key: "q" });
    expect(app.state.modal.kind).toBe("none");
    expect(app.quit).toBe(false);
  });

  test("an operation error while a modal is open falls back to a notice", async () => {
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const { app } = makeApp({ store });
    await app.dispatch({ type: "openSend" });
    await app.dispatch({ type: "updateDraft", draft: "keep" });
    app.reportOperationError({ code: "timeout", message: "boom" });
    // The draft survives; the error degrades to a notice.
    expect(app.state.modal).toEqual({ kind: "send", draft: "keep" });
    expect(app.view().notice).toEqual({
      level: "error",
      code: "timeout",
      message: "boom",
    });
  });

  test("a manual refresh error stays in a notice without a modal", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const app = new CockpitApp(deps, env, state, new FakeHost());
    const result = await app.dispatch({ type: "refresh" });
    expect(result.error?.code).toBe("config_not_found");
    expect(app.state.modal.kind).toBe("none");
    expect(app.view().modal).toBeNull();
    const notice = app.view().notice;
    expect(notice?.level).toBe("error");
    expect(notice?.level === "error" ? notice.code : null).toBe(
      "config_not_found",
    );
  });

  test("an auto-refresh tick error stays in a notice without a modal", async () => {
    const { FakeConfigLoader } = await import("../../ops/src/testing/fakes.ts");
    const store = new FakeStore();
    store.sessions.push(makeSession({ id: "s1" }));
    const env = makeEnv();
    const state = createCockpitState(env, snapshot([...store.sessions]));
    const deps = makeOpsDeps({
      store,
      configLoader: new FakeConfigLoader({ kind: "not_found" }),
    });
    const host = new FakeHost(["tick", null]);
    const app = new CockpitApp(deps, env, state, host);
    await app.run();
    // The tick error never opens a modal — it would reopen every interval.
    const last = host.lastFrame();
    expect(last?.modal).toBeNull();
    expect(last?.notice?.level).toBe("error");
    expect(last?.notice?.level === "error" ? last.notice.code : null).toBe(
      "config_not_found",
    );
  });
});
