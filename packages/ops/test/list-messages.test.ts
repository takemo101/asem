import { describe, expect, test } from "bun:test";
import { type CurrentSessionRef, hashToken } from "@asem/core";
import { listMessages } from "../src/index.ts";
import {
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeStore,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import {
  expectErr,
  expectOk,
  makeMessage,
  makeSession,
  scopeA,
  scopeB,
} from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const RAW_TOKEN = "tok-me";
const scopeC = { ...scopeB, workspaceId: "ws_2" };

/** A store holding a valid current Session `me` plus assorted messages. */
function seededStore() {
  const store = new FakeStore();
  const me = makeSession({ name: "me", tokenHash: hashToken(RAW_TOKEN) });
  store.sessions.push(me);
  return { store, me };
}

function depsWith(
  store: FakeStore,
  ref: CurrentSessionRef | null = null,
  overrides = {},
) {
  return makeOpsDeps({
    store,
    scopeResolver: new FakeScopeResolver(scopeA),
    currentSessionResolver: new FakeCurrentSessionResolver(ref),
    ...overrides,
  });
}

describe("listMessages", () => {
  test("returns Workspace history across worktree roots", async () => {
    const { store } = seededStore();
    const a = makeMessage({ body: "a" });
    const b = makeMessage({
      body: "b",
      workspaceId: scopeB.workspaceId,
      worktreeRoot: scopeB.worktreeRoot,
    });
    const c = makeMessage({
      body: "c",
      workspaceId: scopeC.workspaceId,
      worktreeRoot: scopeC.worktreeRoot,
    });
    store.messages.push(a, b, c);

    const { messages } = expectOk(
      await listMessages(depsWith(store), { filter: undefined }, CTX),
    );
    const ids = messages.map((m) => m.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id);
  });

  test("narrows normal history by worktreeRoot", async () => {
    const { store } = seededStore();
    const here = makeMessage({
      body: "here",
      worktreeRoot: scopeA.worktreeRoot,
    });
    const there = makeMessage({
      body: "there",
      worktreeRoot: scopeB.worktreeRoot,
    });
    store.messages.push(here, there);

    const { messages } = expectOk(
      await listMessages(
        depsWith(store),
        { filter: { worktreeRoot: scopeA.worktreeRoot } },
        CTX,
      ),
    );
    expect(messages.map((m) => m.id)).toEqual([here.id]);
  });

  test("narrows normal history to one target with toSessionId", async () => {
    const { store } = seededStore();
    store.messages.push(
      makeMessage({ toSessionId: "s_x" }),
      makeMessage({ toSessionId: "s_y" }),
    );

    const { messages } = expectOk(
      await listMessages(
        depsWith(store),
        { filter: { toSessionId: "s_x" } },
        CTX,
      ),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.toSessionId).toBe("s_x");
  });

  test("inbox returns only messages addressed to the current Session", async () => {
    const { store, me } = seededStore();
    const mine = makeMessage({ toSessionId: me.id, body: "for me" });
    const theirs = makeMessage({ toSessionId: "s_other", body: "not me" });
    store.messages.push(mine, theirs);

    const ref: CurrentSessionRef = { sessionId: me.id, token: RAW_TOKEN };
    const { messages } = expectOk(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true } },
        CTX,
      ),
    );
    expect(messages.map((m) => m.id)).toEqual([mine.id]);
  });

  test("undelivered filter returns only messages with no delivered_at", async () => {
    const { store } = seededStore();
    const pending = makeMessage({ deliveredAt: null });
    const done = makeMessage({ deliveredAt: "2026-06-05T12:30:00.000Z" });
    store.messages.push(pending, done);

    const { messages } = expectOk(
      await listMessages(
        depsWith(store),
        { filter: { undelivered: true } },
        CTX,
      ),
    );
    expect(messages.map((m) => m.id)).toEqual([pending.id]);
  });

  test("inbox + undelivered compose: undelivered messages addressed to me", async () => {
    const { store, me } = seededStore();
    const minePending = makeMessage({ toSessionId: me.id, deliveredAt: null });
    const mineDone = makeMessage({
      toSessionId: me.id,
      deliveredAt: "2026-06-05T12:30:00.000Z",
    });
    const othersPending = makeMessage({
      toSessionId: "s_other",
      deliveredAt: null,
    });
    store.messages.push(minePending, mineDone, othersPending);

    const ref: CurrentSessionRef = { sessionId: me.id, token: RAW_TOKEN };
    const { messages } = expectOk(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true, undelivered: true } },
        CTX,
      ),
    );
    expect(messages.map((m) => m.id)).toEqual([minePending.id]);
  });

  // --- inbox auth error ladder ---------------------------------------------

  test("inbox surfaces current_session_not_found when no current Session", async () => {
    const { store } = seededStore();
    expectErr(
      await listMessages(
        depsWith(store, null),
        { filter: { inbox: true } },
        CTX,
      ),
      "current_session_not_found",
    );
  });

  test("inbox surfaces invalid_session_token when the token does not verify", async () => {
    const { store, me } = seededStore();
    const ref: CurrentSessionRef = { sessionId: me.id, token: "wrong" };
    expectErr(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true } },
        CTX,
      ),
      "invalid_session_token",
    );
  });

  test("inbox surfaces session_not_found when the pointer references an absent row", async () => {
    const { store } = seededStore();
    const ref: CurrentSessionRef = { sessionId: "ghost", token: RAW_TOKEN };
    expectErr(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true } },
        CTX,
      ),
      "session_not_found",
    );
  });

  test("inbox surfaces scope_mismatch when the pointer was registered in another Workspace", async () => {
    const { store, me } = seededStore();
    const ref: CurrentSessionRef = {
      sessionId: me.id,
      token: RAW_TOKEN,
      scope: scopeC,
    };
    expectErr(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true } },
        CTX,
      ),
      "scope_mismatch",
    );
  });

  test("non-inbox reads never touch the current-session resolver", async () => {
    const { store } = seededStore();
    // A null ref would error if resolved; normal history must not resolve it.
    const { messages } = expectOk(
      await listMessages(depsWith(store, null), { filter: undefined }, CTX),
    );
    expect(messages).toEqual([]);
  });
});
