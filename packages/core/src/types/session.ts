import { z } from "zod";
import { isoTimestamp, nonEmptyString } from "./common.ts";

/**
 * Session status is process/connection state only. It must never be used to
 * represent task outcome or work completion (see CONTEXT.md and the design doc).
 */
export const sessionStatusSchema = z.enum([
  "starting",
  "running",
  "exited",
  "missing",
  "closed",
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * Multiplexer-specific coordinates (herdr workspace/tab/pane, tmux
 * session/window/pane, etc). Stored as `mux_ref_json` by `@asem/store`.
 */
export const muxRefSchema = z.record(z.string(), z.unknown());

export type MuxRef = z.infer<typeof muxRefSchema>;

/**
 * A Session is one registered agent CLI process running in a multiplexer pane.
 * This is the canonical domain shape; `@asem/store` is responsible for mapping
 * SQLite rows to and from this type.
 */
export const sessionSchema = z
  .object({
    id: nonEmptyString,
    workspaceId: nonEmptyString,
    worktreeRoot: nonEmptyString,
    name: nonEmptyString,
    cwd: nonEmptyString,
    agent: nonEmptyString,
    mux: nonEmptyString,
    /**
     * The model the Session was launched with, or null when none was selected
     * (MIK-040). This is launch metadata only — asem does not validate model
     * names, map aliases, or infer anything about the Agent's behavior from it.
     */
    model: nonEmptyString.nullable(),
    parentSessionId: nonEmptyString.nullable(),
    status: sessionStatusSchema,
    muxRef: muxRefSchema,
    sessionDir: nonEmptyString,
    /** Only the hash of the Session token is ever persisted. */
    tokenHash: nonEmptyString,
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
    closedAt: isoTimestamp.nullable(),
  })
  .strict();

export type Session = z.infer<typeof sessionSchema>;
