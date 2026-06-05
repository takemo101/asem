import { describe, expect, test } from "bun:test";
import { hashToken, verifyToken } from "../src/index.ts";

describe("hashToken", () => {
  test("produces a versioned sha256 hex digest", () => {
    const hash = hashToken("super-secret-token");
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("is deterministic for the same token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  test("differs for different tokens", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  test("does not echo the raw token in the hash", () => {
    const token = "raw-token-material";
    expect(hashToken(token)).not.toContain(token);
  });

  test("throws on empty token", () => {
    expect(() => hashToken("")).toThrow();
  });
});

describe("verifyToken", () => {
  test("verifies a matching token", () => {
    const token = "high-entropy-token";
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
  });

  test("rejects a non-matching token", () => {
    const hash = hashToken("correct-token");
    expect(verifyToken("wrong-token", hash)).toBe(false);
  });

  test("rejects an empty token", () => {
    const hash = hashToken("correct-token");
    expect(verifyToken("", hash)).toBe(false);
  });

  test("rejects an empty hash", () => {
    expect(verifyToken("any-token", "")).toBe(false);
  });

  test("rejects a malformed hash without throwing", () => {
    expect(verifyToken("any-token", "not-a-valid-hash")).toBe(false);
  });
});
