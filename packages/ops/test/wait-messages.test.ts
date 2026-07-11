import { describe, expect, test } from "bun:test";
import { hashToken, type Message } from "@asem/core";
import { listMessages, waitMessages } from "../src/index.ts";
import {
  FakeClock,
  FakeCurrentSessionResolver,
  FakeScopeResolver,
  FakeSleeper,
  FakeStore,
  makeOpsDeps,
} from "../src/testing/fakes.ts";
import {
  expectErr,
  expectOk,
  makeMessage,
  makeSession,
  scopeA,
} from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const RAW_TOKEN = "tok-me";

/**
 * Fully faked wait fixture: the FakeSleeper advances the FakeClock by each
 * slept interval, so bounded waits elapse deterministically with no real time.
 */
function fixture() {
  const store = new FakeStore();
  const me = makeSession({ name: "me", tokenHash: hashToken(RAW_TOKEN) });
  store.sessions.push(me);
  const clock = new FakeClock();
  const sleeper = new FakeSleeper(clock);
  const deps = makeOpsDeps({
    store,
    clock,
    sleeper,
    scopeResolver: new FakeScopeResolver(scopeA),
    currentSessionResolver: new FakeCurrentSessionResolver({
      sessionId: me.id,
      token: RAW_TOKEN,
    }),
  });
  return { store, me, clock, sleeper, deps };
}

/** Current high-water Inbox cursor, as the Agent protocol captures it. */
async function inboxCursor(deps: ReturnType<typeof fixture>["deps"]) {
  return expectOk(await listMessages(deps, { filter: { inbox: true } }, CTX))
    .nextCursor;
}

function toMe(me: { id: string }, overrides: Partial<Message> = {}): Message {
  return makeMessage({ toSessionId: me.id, ...overrides });
}

describe("waitMessages", () => {
  test("returns Inbox Messages already past the cursor without sleeping", async () => {
    const { store, me, sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);
    await store.insertMessage(toMe(me, { body: "already-here" }));

    const page = expectOk(await waitMessages(deps, { cursor }, CTX));
    expect(page.messages.map((m) => m.body)).toEqual(["already-here"]);
    expect(page.timedOut).toBe(false);
    expect(page.hasMore).toBe(false);
    expect(sleeper.waits).toEqual([]);
  });

  test("polls once per second until a delayed Message arrives", async () => {
    const { store, me, sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);
    sleeper.onSleep = async (_ms, count) => {
      if (count === 3) {
        await store.insertMessage(toMe(me, { body: "late" }));
      }
    };

    const page = expectOk(await waitMessages(deps, { cursor }, CTX));
    expect(page.messages.map((m) => m.body)).toEqual(["late"]);
    expect(page.timedOut).toBe(false);
    expect(sleeper.waits).toEqual([1_000, 1_000, 1_000]);
  });

  test("a burst returns one bounded page that continues without skips", async () => {
    const { store, me, sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);
    sleeper.onSleep = async (_ms, count) => {
      if (count === 1) {
        await store.insertMessage(toMe(me, { body: "b1" }));
        await store.insertMessage(toMe(me, { body: "b2" }));
        await store.insertMessage(toMe(me, { body: "b3" }));
      }
    };

    const page = expectOk(await waitMessages(deps, { cursor, limit: 2 }, CTX));
    expect(page.messages.map((m) => m.body)).toEqual(["b1", "b2"]);
    expect(page.hasMore).toBe(true);
    expect(page.timedOut).toBe(false);

    // The returned cursor picks up the rest of the burst immediately.
    const rest = expectOk(
      await waitMessages(deps, { cursor: page.nextCursor }, CTX),
    );
    expect(rest.messages.map((m) => m.body)).toEqual(["b3"]);
  });

  test("times out as success after the default 30s with an empty page", async () => {
    const { sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);

    const page = expectOk(await waitMessages(deps, { cursor }, CTX));
    expect(page.messages).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.timedOut).toBe(true);
    // Default timeout 30s at a fixed 1s poll interval.
    expect(sleeper.waits).toHaveLength(30);
    expect(sleeper.waits.every((ms) => ms === 1_000)).toBe(true);
    // The anchor did not move: the timed-out cursor equals the input cursor.
    expect(page.nextCursor).toBe(cursor);
  });

  test("no filter can skip Inbox Messages: foreign-target arrivals never match, mine do", async () => {
    const { store, me, sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);
    sleeper.onSleep = async (_ms, count) => {
      // A Message for someone else must not complete or advance the wait.
      await store.insertMessage(makeMessage({ toSessionId: "s_other" }));
      if (count === 2) {
        await store.insertMessage(toMe(me, { body: "mine", kind: "report" }));
      }
    };

    const page = expectOk(await waitMessages(deps, { cursor }, CTX));
    expect(page.messages.map((m) => m.body)).toEqual(["mine"]);
    expect(page.timedOut).toBe(false);
  });

  test("accepts the 60s max timeout and waits the full bound", async () => {
    const { sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);

    const page = expectOk(
      await waitMessages(deps, { cursor, timeoutMs: 60_000 }, CTX),
    );
    expect(page.timedOut).toBe(true);
    expect(sleeper.waits).toHaveLength(60);
  });

  test("a timeout above the 60s max is invalid_input before any polling", async () => {
    const { sleeper, deps } = fixture();
    const cursor = await inboxCursor(deps);

    expectErr(
      await waitMessages(deps, { cursor, timeoutMs: 60_001 }, CTX),
      "invalid_input",
    );
    expect(sleeper.waits).toEqual([]);
  });

  test("a non-positive timeout is invalid_input", async () => {
    const { deps } = fixture();
    const cursor = await inboxCursor(deps);
    expectErr(
      await waitMessages(deps, { cursor, timeoutMs: 0 }, CTX),
      "invalid_input",
    );
  });

  test("the literal latest cursor is invalid_input", async () => {
    const { deps } = fixture();
    expectErr(
      await waitMessages(deps, { cursor: "latest" }, CTX),
      "invalid_input",
    );
  });

  test("a cursor bound to a non-Inbox view is invalid_input", async () => {
    const { deps } = fixture();
    // Unfiltered scope history: a different query identity than the Inbox.
    const historyCursor = expectOk(
      await listMessages(deps, {}, CTX),
    ).nextCursor;
    expectErr(
      await waitMessages(deps, { cursor: historyCursor }, CTX),
      "invalid_input",
    );

    // Inbox narrowed by an extra filter is also not the unfiltered Inbox.
    const undeliveredCursor = expectOk(
      await listMessages(
        deps,
        { filter: { inbox: true, undelivered: true } },
        CTX,
      ),
    ).nextCursor;
    expectErr(
      await waitMessages(deps, { cursor: undeliveredCursor }, CTX),
      "invalid_input",
    );
  });

  test("switching the current Session invalidates a prior Inbox cursor", async () => {
    const store = new FakeStore();
    const one = makeSession({ name: "one", tokenHash: hashToken("tok-one") });
    const two = makeSession({ name: "two", tokenHash: hashToken("tok-two") });
    store.sessions.push(one, two);
    const clock = new FakeClock();
    const sleeper = new FakeSleeper(clock);
    const base = {
      store,
      clock,
      sleeper,
      scopeResolver: new FakeScopeResolver(scopeA),
    };

    const depsOne = makeOpsDeps({
      ...base,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: one.id,
        token: "tok-one",
      }),
    });
    const cursor = expectOk(
      await listMessages(depsOne, { filter: { inbox: true } }, CTX),
    ).nextCursor;

    const depsTwo = makeOpsDeps({
      ...base,
      currentSessionResolver: new FakeCurrentSessionResolver({
        sessionId: two.id,
        token: "tok-two",
      }),
    });
    expectErr(await waitMessages(depsTwo, { cursor }, CTX), "invalid_input");
    expect(sleeper.waits).toEqual([]);
  });

  test("a cursor never authorizes: missing current Session fails the auth ladder", async () => {
    const { deps } = fixture();
    const cursor = await inboxCursor(deps);

    const anonymous = makeOpsDeps({
      store: deps.store,
      clock: deps.clock,
      sleeper: deps.sleeper,
      scopeResolver: new FakeScopeResolver(scopeA),
      currentSessionResolver: new FakeCurrentSessionResolver(null),
    });
    expectErr(
      await waitMessages(anonymous, { cursor }, CTX),
      "current_session_not_found",
    );
  });

  test("projects only PublicMessage fields", async () => {
    const { store, me, deps } = fixture();
    const cursor = await inboxCursor(deps);
    await store.insertMessage(
      toMe(me, { deliveredAt: "2026-06-05T12:30:00.000Z" }),
    );

    const page = expectOk(await waitMessages(deps, { cursor }, CTX));
    expect(Object.keys(page.messages[0]!).sort()).toEqual([
      "body",
      "createdAt",
      "delivery",
      "fromSessionId",
      "id",
      "kind",
      "toSessionId",
    ]);
  });
});
