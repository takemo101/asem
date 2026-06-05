import { z } from "zod";
import { isoTimestamp, nonEmptyString } from "./common.ts";

/**
 * A Message is a communication from one Session to another. A Report is just a
 * Message with `kind="report"` addressed to the parent Session; it does not
 * imply completion.
 */
export const messageKindSchema = z.enum(["message", "report"]);

export type MessageKind = z.infer<typeof messageKindSchema>;

/**
 * A Message is a durable record plus a best-effort delivery attempt into the
 * target Session's multiplexer pane. Delivery state is recorded truthfully:
 * `deliveredAt` on success or `deliveryError` on failure. There is no ack or
 * read receipt.
 */
export const messageSchema = z
  .object({
    id: nonEmptyString,
    workspaceId: nonEmptyString,
    worktreeRoot: nonEmptyString,
    /** Null when the Message did not originate from a known Session. */
    fromSessionId: nonEmptyString.nullable(),
    toSessionId: nonEmptyString,
    kind: messageKindSchema,
    /** User-provided body. */
    body: z.string(),
    /** Exact text delivered to the multiplexer pane. */
    formattedBody: z.string(),
    deliveredAt: isoTimestamp.nullable(),
    deliveryError: z.string().nullable(),
    createdAt: isoTimestamp,
  })
  .strict();

export type Message = z.infer<typeof messageSchema>;
