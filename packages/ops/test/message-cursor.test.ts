import { describe, expect, test } from "bun:test";
import {
  decodeMessageCursor,
  encodeMessageCursor,
  type MessageCursorBinding,
  messageCursorBinding,
} from "../src/message-cursor.ts";
import { expectErr, expectOk } from "./helpers.ts";

const plain: MessageCursorBinding = { workspaceId: "ws_1" };
const inbox: MessageCursorBinding = {
  workspaceId: "ws_1",
  toSessionId: "s_me",
};

function forge(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("message cursor codec", () => {
  test("round-trips an exclusive sequence position for the same binding", () => {
    const cursor = encodeMessageCursor(plain, 42);
    const decoded = expectOk(decodeMessageCursor(cursor, plain));
    expect(decoded.afterSequence).toBe(42);
  });

  test("cursors are opaque base64url strings", () => {
    const cursor = encodeMessageCursor(inbox, 7);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("decoding yields only a sequence position — no authorization material", () => {
    const decoded = expectOk(
      decodeMessageCursor(encodeMessageCursor(inbox, 9), inbox),
    );
    expect(decoded).toEqual({ afterSequence: 9 });
  });

  test("rejects malformed cursors with invalid_input", () => {
    expectErr(decodeMessageCursor("not base64url!!", plain), "invalid_input");
    expectErr(
      decodeMessageCursor(
        Buffer.from("not json", "utf8").toString("base64url"),
        plain,
      ),
      "invalid_input",
    );
    expectErr(
      decodeMessageCursor(
        Buffer.from("{}", "utf8").toString("base64url"),
        plain,
      ),
      "invalid_input",
    );
  });

  test("rejects an unknown cursor version", () => {
    expectErr(
      decodeMessageCursor(
        forge({ v: 2, workspaceId: "ws_1", afterSequence: 1 }),
        plain,
      ),
      "invalid_input",
    );
  });

  test("rejects a tampered payload", () => {
    const cursor = encodeMessageCursor(plain, 5);
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    payload.workspaceId = "ws_evil";
    expectErr(decodeMessageCursor(forge(payload), plain), "invalid_input");
  });

  test("rejects an unexpected payload field", () => {
    expectErr(
      decodeMessageCursor(
        forge({ v: 1, workspaceId: "ws_1", afterSequence: 1, admin: true }),
        plain,
      ),
      "invalid_input",
    );
  });

  test("rejects a negative or non-integer sequence position", () => {
    for (const afterSequence of [-1, 1.5]) {
      expectErr(
        decodeMessageCursor(
          forge({ v: 1, workspaceId: "ws_1", afterSequence }),
          plain,
        ),
        "invalid_input",
      );
    }
  });

  test("rejects a Workspace mismatch", () => {
    const cursor = encodeMessageCursor({ workspaceId: "ws_2" }, 1);
    expectErr(decodeMessageCursor(cursor, plain), "invalid_input");
  });

  test("rejects a changed result-changing filter binding", () => {
    const cursor = encodeMessageCursor(inbox, 3);
    expectErr(
      decodeMessageCursor(cursor, { ...inbox, undelivered: true }),
      "invalid_input",
    );
    expectErr(decodeMessageCursor(cursor, plain), "invalid_input");
    expectErr(
      decodeMessageCursor(cursor, { ...inbox, toSessionId: "s_other" }),
      "invalid_input",
    );
  });

  test("binding normalization drops no-op filter spellings", () => {
    expect(messageCursorBinding("ws_1", undefined)).toEqual({
      workspaceId: "ws_1",
    });
    expect(messageCursorBinding("ws_1", { undelivered: false })).toEqual({
      workspaceId: "ws_1",
    });
    expect(
      messageCursorBinding("ws_1", {
        toSessionId: "s_me",
        undelivered: true,
      }),
    ).toEqual({ workspaceId: "ws_1", toSessionId: "s_me", undelivered: true });
  });
});
