import { z } from "zod";

/**
 * Shared schema primitives used across asem domain contracts.
 *
 * These live in `@asem/core` so every package parses domain values the same
 * way. Per the implementation principles, external input is parsed into typed
 * values rather than merely checked.
 */

/** Non-empty identifier or required string field. */
export const nonEmptyString = z.string().min(1);

/**
 * ISO-8601 timestamp string. asem stores timestamps as text (see the SQLite
 * schema in the design doc), so the domain type is a validated string rather
 * than a `Date`.
 */
export const isoTimestamp = z
  .string()
  .datetime({ offset: true })
  .describe("ISO-8601 timestamp");

export type IsoTimestamp = z.infer<typeof isoTimestamp>;
