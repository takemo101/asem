import { describe, expect, test } from "bun:test";
import { type CurrentSessionRef, hashToken, type Message } from "@asem/core";
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

/** Insert messages through the Store so each row gets an internal sequence. */
async function insertAll(store: FakeStore, messages: Message[]): Promise<void> {
  for (const message of messages) {
    await store.insertMessage(message);
  }
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
    await insertAll(store, [a, b, c]);

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
    await insertAll(store, [here, there]);

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
    await insertAll(store, [
      makeMessage({ toSessionId: "s_x" }),
      makeMessage({ toSessionId: "s_y" }),
    ]);

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
    await insertAll(store, [mine, theirs]);

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
    await insertAll(store, [pending, done]);

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
    await insertAll(store, [minePending, mineDone, othersPending]);

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

  // --- cursor pagination (MIK-061) -----------------------------------------

  test("pages oldest-to-newest with no duplicates or skips", async () => {
    const { store } = seededStore();
    await insertAll(
      store,
      ["m1", "m2", "m3", "m4", "m5"].map((body) => makeMessage({ body })),
    );
    const deps = depsWith(store);

    const first = expectOk(await listMessages(deps, { limit: 2 }, CTX));
    expect(first.messages.map((m) => m.body)).toEqual(["m1", "m2"]);
    expect(first.hasMore).toBe(true);

    const second = expectOk(
      await listMessages(deps, { cursor: first.nextCursor, limit: 2 }, CTX),
    );
    expect(second.messages.map((m) => m.body)).toEqual(["m3", "m4"]);
    expect(second.hasMore).toBe(true);

    const third = expectOk(
      await listMessages(deps, { cursor: second.nextCursor, limit: 2 }, CTX),
    );
    expect(third.messages.map((m) => m.body)).toEqual(["m5"]);
    expect(third.hasMore).toBe(false);
  });

  test("always returns a nextCursor; an empty Inbox anchor picks up later Messages", async () => {
    const { store, me } = seededStore();
    const ref: CurrentSessionRef = { sessionId: me.id, token: RAW_TOKEN };
    const deps = depsWith(store, ref);

    const empty = expectOk(
      await listMessages(deps, { filter: { inbox: true } }, CTX),
    );
    expect(empty.messages).toEqual([]);
    expect(empty.hasMore).toBe(false);
    expect(typeof empty.nextCursor).toBe("string");
    expect(empty.nextCursor.length).toBeGreaterThan(0);

    await store.insertMessage(
      makeMessage({ toSessionId: me.id, body: "late" }),
    );
    const next = expectOk(
      await listMessages(
        deps,
        { filter: { inbox: true }, cursor: empty.nextCursor },
        CTX,
      ),
    );
    expect(next.messages.map((m) => m.body)).toEqual(["late"]);
  });

  test("latest returns an empty tail anchor that skips only history", async () => {
    const { store, me } = seededStore();
    await store.insertMessage(makeMessage({ toSessionId: me.id, body: "old" }));
    const ref: CurrentSessionRef = { sessionId: me.id, token: RAW_TOKEN };
    const deps = depsWith(store, ref);

    const tail = expectOk(
      await listMessages(
        deps,
        { filter: { inbox: true }, cursor: "latest" },
        CTX,
      ),
    );
    expect(tail.messages).toEqual([]);
    expect(tail.hasMore).toBe(false);

    await store.insertMessage(makeMessage({ toSessionId: me.id, body: "new" }));
    const page = expectOk(
      await listMessages(
        deps,
        { filter: { inbox: true }, cursor: tail.nextCursor },
        CTX,
      ),
    );
    expect(page.messages.map((m) => m.body)).toEqual(["new"]);
    expect(page.hasMore).toBe(false);
  });

  test("latest on an empty view anchors at the start of future history", async () => {
    const { store } = seededStore();
    const deps = depsWith(store);

    const tail = expectOk(await listMessages(deps, { cursor: "latest" }, CTX));
    expect(tail.messages).toEqual([]);
    expect(tail.hasMore).toBe(false);

    await store.insertMessage(makeMessage({ body: "first" }));
    const page = expectOk(
      await listMessages(deps, { cursor: tail.nextCursor }, CTX),
    );
    expect(page.messages.map((m) => m.body)).toEqual(["first"]);
  });

  test("a page cut by the body budget continues without skips", async () => {
    const { store } = seededStore();
    const big = "x".repeat(200_000);
    await insertAll(store, [
      makeMessage({ body: big }),
      makeMessage({ body: big }),
    ]);
    const deps = depsWith(store);

    const first = expectOk(await listMessages(deps, {}, CTX));
    expect(first.messages).toHaveLength(1);
    expect(first.hasMore).toBe(true);

    const second = expectOk(
      await listMessages(deps, { cursor: first.nextCursor }, CTX),
    );
    expect(second.messages).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  test("returns a legacy Message whose body alone exceeds the page budget", async () => {
    const { store } = seededStore();
    await store.insertMessage(makeMessage({ body: "y".repeat(300_000) }));

    const page = expectOk(await listMessages(depsWith(store), {}, CTX));
    expect(page.messages).toHaveLength(1);
    expect(page.hasMore).toBe(false);
  });

  test("a malformed cursor is invalid_input", async () => {
    const { store } = seededStore();
    expectErr(
      await listMessages(depsWith(store), { cursor: "@@not-a-cursor@@" }, CTX),
      "invalid_input",
    );
  });

  test("a cursor from another Workspace is invalid_input", async () => {
    const { store } = seededStore();
    await store.insertMessage(makeMessage());
    const cursor = expectOk(
      await listMessages(depsWith(store), {}, CTX),
    ).nextCursor;

    const elsewhere = makeOpsDeps({
      store,
      scopeResolver: new FakeScopeResolver(scopeC),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
    });
    expectErr(
      await listMessages(elsewhere, { cursor }, { cwd: scopeC.worktreeRoot }),
      "invalid_input",
    );
  });

  test("a cursor reused with a changed filter is invalid_input", async () => {
    const { store } = seededStore();
    const deps = depsWith(store);
    const cursor = expectOk(
      await listMessages(deps, { filter: { toSessionId: "s_x" } }, CTX),
    ).nextCursor;

    expectErr(
      await listMessages(deps, { filter: { toSessionId: "s_y" }, cursor }, CTX),
      "invalid_input",
    );
    expectErr(await listMessages(deps, { cursor }, CTX), "invalid_input");
    expectErr(
      await listMessages(
        deps,
        { filter: { toSessionId: "s_x", undelivered: true }, cursor },
        CTX,
      ),
      "invalid_input",
    );
  });

  test("result-identical filter spellings share one cursor identity", async () => {
    const { store } = seededStore();
    const deps = depsWith(store);
    const cursor = expectOk(
      await listMessages(deps, { filter: { undelivered: false } }, CTX),
    ).nextCursor;
    expectOk(await listMessages(deps, { cursor }, CTX));
  });

  test("an Inbox cursor binds the resolved Session: switching current Session is invalid_input", async () => {
    const store = new FakeStore();
    const one = makeSession({ name: "one", tokenHash: hashToken("tok-one") });
    const two = makeSession({ name: "two", tokenHash: hashToken("tok-two") });
    store.sessions.push(one, two);

    const depsOne = depsWith(store, { sessionId: one.id, token: "tok-one" });
    const cursor = expectOk(
      await listMessages(depsOne, { filter: { inbox: true } }, CTX),
    ).nextCursor;

    const depsTwo = depsWith(store, { sessionId: two.id, token: "tok-two" });
    expectErr(
      await listMessages(depsTwo, { filter: { inbox: true }, cursor }, CTX),
      "invalid_input",
    );
  });

  test("a cursor never authorizes: Inbox auth still runs on every call", async () => {
    const { store, me } = seededStore();
    const ref: CurrentSessionRef = { sessionId: me.id, token: RAW_TOKEN };
    const cursor = expectOk(
      await listMessages(
        depsWith(store, ref),
        { filter: { inbox: true } },
        CTX,
      ),
    ).nextCursor;

    // Same valid cursor, but the current-Session pointer is gone.
    expectErr(
      await listMessages(
        depsWith(store, null),
        { filter: { inbox: true }, cursor },
        CTX,
      ),
      "current_session_not_found",
    );
  });

  test("a cursor never bypasses agent-origin authentication", async () => {
    const { store } = seededStore();
    const cursor = expectOk(
      await listMessages(depsWith(store), {}, CTX),
    ).nextCursor;
    expectErr(
      await listMessages(
        depsWith(store, null),
        { cursor },
        { ...CTX, origin: "agent" },
      ),
      "current_session_not_found",
    );
  });

  test("projects only PublicMessage fields", async () => {
    const { store } = seededStore();
    await store.insertMessage(
      makeMessage({ deliveredAt: "2026-06-05T12:30:00.000Z" }),
    );

    const { messages } = expectOk(await listMessages(depsWith(store), {}, CTX));
    expect(Object.keys(messages[0]!).sort()).toEqual([
      "body",
      "createdAt",
      "delivery",
      "fromSessionId",
      "id",
      "kind",
      "toSessionId",
    ]);
  });

  test("rejects a limit above the maximum page size", async () => {
    const { store } = seededStore();
    expectErr(
      await listMessages(depsWith(store), { limit: 51 }, CTX),
      "invalid_input",
    );
  });
});
