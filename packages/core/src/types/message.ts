import { z } from "zod";
import { isoTimestamp, nonEmptyString } from "./common.ts";

/**
 * A Message is a communication from one Session to another. A Report is just a
 * Message with `kind="report"` addressed to the parent Session; it does not
 * imply completion.
 */
export const messageKindSchema = z.enum(["message", "report"]);

export type MessageKind = z.infer<typeof messageKindSchema>;

/** Maximum UTF-8 byte length accepted for newly created Message bodies. */
export const MAX_MESSAGE_BODY_BYTES = 65_536;

export const messageBodySchema = z.string().superRefine((value, context) => {
  if (Buffer.byteLength(value, "utf8") > MAX_MESSAGE_BODY_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Message body must be at most ${MAX_MESSAGE_BODY_BYTES} UTF-8 bytes`,
    });
  }
});

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

export const publicMessageDeliverySchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("delivered"), deliveredAt: isoTimestamp })
    .strict(),
  z.object({ status: z.literal("undelivered") }).strict(),
  z.object({ status: z.literal("failed"), error: z.string() }).strict(),
]);

export const publicMessageSchema = z
  .object({
    id: nonEmptyString,
    fromSessionId: nonEmptyString.nullable(),
    toSessionId: nonEmptyString,
    kind: messageKindSchema,
    body: z.string(),
    createdAt: isoTimestamp,
    delivery: publicMessageDeliverySchema,
  })
  .strict();

/** Stable public projection for CLI and MCP Message results. */
export type PublicMessage = z.infer<typeof publicMessageSchema>;
