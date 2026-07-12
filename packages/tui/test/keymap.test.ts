import { describe, expect, test } from "bun:test";
import type { CockpitAction, CockpitSnapshot } from "../src/index.ts";
import {
  createCockpitState,
  dispatchCockpit,
  type KeyEvent,
  keyToAction,
} from "../src/index.ts";
import { makeEnv, makeSession } from "./helpers.ts";

function snapshot(sessions = [makeSession({ id: "s1" })]): CockpitSnapshot {
  return { sessions, messages: [] };
}

function baseState() {
  return createCockpitState(makeEnv(), snapshot());
}

describe("normal-mode keys", () => {
  const cases: Array<[KeyEvent, CockpitAction["type"]]> = [
    [{ key: "down" }, "selectNext"],
    [{ key: "j" }, "selectNext"],
    [{ key: "up" }, "selectPrev"],
    [{ key: "k" }, "selectPrev"],
    [{ key: "tab" }, "switchTab"],
    [{ key: "a" }, "attach"],
    [{ key: "s" }, "openSend"],
    [{ key: "c" }, "requestClose"],
    [{ key: "D" }, "requestDelete"],
    [{ key: "r" }, "refresh"],
    [{ key: "e" }, "toggleExpand"],
    [{ key: "f" }, "cycleFilter"],
    [{ key: "?" }, "toggleHelp"],
    [{ key: "q" }, "quit"],
  ];
  for (const [event, type] of cases) {
    test(`${JSON.stringify(event)} -> ${type}`, () => {
      expect(keyToAction(baseState(), event)?.type).toBe(type);
    });
  }

  test("unbound keys map to null", () => {
    expect(keyToAction(baseState(), { key: "z" })).toBeNull();
    expect(keyToAction(baseState(), { key: "c", ctrl: true })).toBeNull();
  });
});

describe("send-modal keys (multiline editing)", () => {
  function sendState() {
    return dispatchCockpit(baseState(), { type: "openSend" }).state;
  }

  test("printable characters append to the draft", () => {
    const state = sendState();
    expect(keyToAction(state, { key: "h" })).toEqual({
      type: "updateDraft",
      draft: "h",
    });
  });

  test("Enter inserts a newline; Ctrl+Enter sends", () => {
    let state = sendState();
    state = dispatchCockpit(state, { type: "updateDraft", draft: "ab" }).state;
    expect(keyToAction(state, { key: "return" })).toEqual({
      type: "updateDraft",
      draft: "ab\n",
    });
    expect(keyToAction(state, { key: "return", ctrl: true })).toEqual({
      type: "submitSend",
    });
  });

  test("Backspace trims the last character; Esc cancels", () => {
    let state = sendState();
    state = dispatchCockpit(state, { type: "updateDraft", draft: "xy" }).state;
    expect(keyToAction(state, { key: "backspace" })).toEqual({
      type: "updateDraft",
      draft: "x",
    });
    expect(keyToAction(state, { key: "escape" })?.type).toBe("cancelModal");
  });

  test("q in the send modal edits the draft instead of quitting", () => {
    const state = sendState();
    expect(keyToAction(state, { key: "q" })).toEqual({
      type: "updateDraft",
      draft: "q",
    });
  });
});

describe("confirm-modal keys", () => {
  function confirmState() {
    return dispatchCockpit(baseState(), { type: "requestDelete" }).state;
  }

  test("y / Enter confirm; n / Esc cancel", () => {
    expect(keyToAction(confirmState(), { key: "y" })?.type).toBe("confirm");
    expect(keyToAction(confirmState(), { key: "return" })?.type).toBe(
      "confirm",
    );
    expect(keyToAction(confirmState(), { key: "n" })?.type).toBe("cancelModal");
    expect(keyToAction(confirmState(), { key: "escape" })?.type).toBe(
      "cancelModal",
    );
  });
});

describe("error-modal keys", () => {
  function errorState() {
    return dispatchCockpit(baseState(), {
      type: "showError",
      code: "session_not_found",
      message: "boom",
    }).state;
  }

  test("Esc / Enter / q all dismiss the error modal", () => {
    expect(keyToAction(errorState(), { key: "escape" })?.type).toBe(
      "cancelModal",
    );
    expect(keyToAction(errorState(), { key: "return" })?.type).toBe(
      "cancelModal",
    );
    expect(keyToAction(errorState(), { key: "enter" })?.type).toBe(
      "cancelModal",
    );
    expect(keyToAction(errorState(), { key: "q" })?.type).toBe("cancelModal");
  });

  test("q dismisses the error modal instead of quitting", () => {
    expect(keyToAction(errorState(), { key: "q" })).toEqual({
      type: "cancelModal",
    });
  });

  test("other keys are inert while the error modal is open", () => {
    expect(keyToAction(errorState(), { key: "x" })).toBeNull();
    expect(keyToAction(errorState(), { key: "down" })).toBeNull();
    expect(keyToAction(errorState(), { key: "?" })).toBeNull();
    expect(keyToAction(errorState(), { key: "s" })).toBeNull();
  });
});

describe("help-modal keys", () => {
  test("? and Esc close the help overlay", () => {
    const state = dispatchCockpit(baseState(), { type: "toggleHelp" }).state;
    expect(keyToAction(state, { key: "?" })?.type).toBe("toggleHelp");
    expect(keyToAction(state, { key: "escape" })?.type).toBe("toggleHelp");
  });
});
