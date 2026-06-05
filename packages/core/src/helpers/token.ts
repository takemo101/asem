import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Token hashing/verification helpers.
 *
 * Session tokens are high-entropy secrets. asem persists only the hash (the
 * `token_hash` column / token-bearing files hold the raw token at mode 0600).
 * These helpers are pure computation: no filesystem, network, or global state,
 * so they are safe to live in `@asem/core`.
 *
 * The hash is a versioned, deterministic SHA-256 digest. Determinism keeps the
 * stored hash comparable across processes; a per-token salt is unnecessary
 * because tokens are high-entropy and not user-chosen.
 */

const TOKEN_HASH_ALGORITHM = "sha256";
const TOKEN_HASH_PREFIX = `${TOKEN_HASH_ALGORITHM}:`;

/**
 * Hash a raw Session token into its persisted form, e.g. `sha256:<hex>`.
 *
 * @throws if `token` is empty — an empty token is a programming error, not a
 * recoverable condition.
 */
export function hashToken(token: string): string {
  if (token.length === 0) {
    throw new Error("hashToken: token must be a non-empty string");
  }
  const digest = createHash(TOKEN_HASH_ALGORITHM)
    .update(token, "utf8")
    .digest("hex");
  return `${TOKEN_HASH_PREFIX}${digest}`;
}

/**
 * Verify a raw token against a stored hash using a constant-time comparison.
 *
 * Returns `false` (never throws) for empty input or malformed hashes so callers
 * can treat any failure uniformly as `invalid_session_token`.
 */
export function verifyToken(token: string, tokenHash: string): boolean {
  if (token.length === 0 || tokenHash.length === 0) {
    return false;
  }
  let expected: string;
  try {
    expected = hashToken(token);
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(tokenHash, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}
