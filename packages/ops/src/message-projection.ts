import type { Message, PublicMessage } from "@asem/core";

/** Project the internal audit record to the stable CLI/MCP Message envelope. */
export function projectPublicMessage(message: Message): PublicMessage {
  const delivery =
    message.deliveredAt !== null
      ? { status: "delivered" as const, deliveredAt: message.deliveredAt }
      : message.deliveryError !== null
        ? { status: "failed" as const, error: message.deliveryError }
        : { status: "undelivered" as const };

  return {
    id: message.id,
    fromSessionId: message.fromSessionId,
    toSessionId: message.toSessionId,
    kind: message.kind,
    body: message.body,
    createdAt: message.createdAt,
    delivery,
  };
}
