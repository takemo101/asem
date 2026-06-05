import { z } from "zod";
import { nonEmptyString } from "./common.ts";
import { sessionStatusSchema, type Session } from "./session.ts";
import { messageKindSchema, type Message } from "./message.ts";
import { muxRefSchema } from "./session.ts";

/**
 * Operation input/output contracts shared by CLI and MCP surfaces.
 *
 * `@asem/core` owns these contracts; `@asem/ops` owns the behavior. Inputs are
 * zod schemas so surfaces parse-don't-check external arguments; outputs are
 * composed from the domain types. Behavior is intentionally absent in MIK-001.
 */

/** Scope filters allowed when listing Sessions. */
export const sessionListFilterSchema = z
  .object({
    status: sessionStatusSchema.optional(),
    parentSessionId: nonEmptyString.nullable().optional(),
  })
  .strict();

export type SessionListFilter = z.infer<typeof sessionListFilterSchema>;

/** Scope filters allowed when listing Messages. */
export const messageListFilterSchema = z
  .object({
    toSessionId: nonEmptyString.optional(),
    inbox: z.boolean().optional(),
    undelivered: z.boolean().optional(),
  })
  .strict();

export type MessageListFilter = z.infer<typeof messageListFilterSchema>;

// --- init project ---------------------------------------------------------

export const initProjectInputSchema = z
  .object({
    workspaceId: nonEmptyString,
    cwd: nonEmptyString,
  })
  .strict();
export type InitProjectInput = z.infer<typeof initProjectInputSchema>;
export interface InitProjectOutput {
  configPath: string;
}

// --- register current session --------------------------------------------

export const initSessionInputSchema = z
  .object({
    name: nonEmptyString,
    agent: nonEmptyString.optional(),
    mux: nonEmptyString.optional(),
    muxRef: muxRefSchema,
    parentSessionId: nonEmptyString.nullable().optional(),
  })
  .strict();
export type InitSessionInput = z.infer<typeof initSessionInputSchema>;
export interface InitSessionOutput {
  session: Session;
  /** Raw token, returned once for the caller to export; never persisted. */
  token: string;
}

// --- create session -------------------------------------------------------

export const createSessionInputSchema = z
  .object({
    name: nonEmptyString,
    prompt: z.string(),
    agent: nonEmptyString.optional(),
    mux: nonEmptyString.optional(),
    cwd: nonEmptyString.optional(),
    parentSessionId: nonEmptyString.optional(),
    root: z.boolean().optional(),
  })
  .strict();
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export interface CreateSessionOutput {
  session: Session;
}

// --- list / get -----------------------------------------------------------

export const listSessionsInputSchema = z
  .object({
    filter: sessionListFilterSchema.optional(),
  })
  .strict();
export type ListSessionsInput = z.infer<typeof listSessionsInputSchema>;
export interface ListSessionsOutput {
  sessions: Session[];
}

export const getSessionInputSchema = z
  .object({
    id: nonEmptyString,
  })
  .strict();
export type GetSessionInput = z.infer<typeof getSessionInputSchema>;
export interface GetSessionOutput {
  session: Session;
  attachHint?: string;
}

// --- close / delete -------------------------------------------------------

export const closeSessionInputSchema = z
  .object({
    id: nonEmptyString,
  })
  .strict();
export type CloseSessionInput = z.infer<typeof closeSessionInputSchema>;
export interface CloseSessionOutput {
  session: Session;
}

export const deleteSessionInputSchema = z
  .object({
    id: nonEmptyString,
    force: z.boolean().optional(),
  })
  .strict();
export type DeleteSessionInput = z.infer<typeof deleteSessionInputSchema>;
export interface DeleteSessionOutput {
  deletedSessionId: string;
  deletedMessageCount: number;
}

// --- messages -------------------------------------------------------------

export const sendMessageInputSchema = z
  .object({
    toSessionId: nonEmptyString,
    body: z.string(),
    kind: messageKindSchema.optional(),
  })
  .strict();
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
export interface SendMessageOutput {
  message: Message;
}

export const listMessagesInputSchema = z
  .object({
    filter: messageListFilterSchema.optional(),
  })
  .strict();
export type ListMessagesInput = z.infer<typeof listMessagesInputSchema>;
export interface ListMessagesOutput {
  messages: Message[];
}

export const reportParentInputSchema = z
  .object({
    body: z.string(),
  })
  .strict();
export type ReportParentInput = z.infer<typeof reportParentInputSchema>;
export interface ReportParentOutput {
  message: Message;
}
