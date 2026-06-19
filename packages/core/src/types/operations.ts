import { z } from "zod";
import { nonEmptyString } from "./common.ts";
import { agentConfigSchema, muxConfigSchema } from "./config.ts";
import { type Message, messageKindSchema } from "./message.ts";
import { muxRefSchema, type Session, sessionStatusSchema } from "./session.ts";

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
    workspaceId: nonEmptyString.optional(),
    cwd: nonEmptyString,
    mux: muxConfigSchema.optional(),
    agent: agentConfigSchema.optional(),
  })
  .strict();
export type InitProjectInput = z.infer<typeof initProjectInputSchema>;
export interface InitProjectOutput {
  configPath: string;
  configCreated: boolean;
  gitignoreUpdated: boolean;
}

// --- register current session --------------------------------------------

export const initSessionInputSchema = z
  .object({
    name: nonEmptyString,
    agent: nonEmptyString.optional(),
    mux: nonEmptyString.optional(),
    // Optional: `init-session` inside a complete herdr environment derives the
    // current pane's mux ref automatically, so callers need not pass one. When
    // both are present, explicit muxRef fields win over derived identifiers
    // (MIK-049). Defaults to an empty ref in the operation.
    muxRef: muxRefSchema.optional(),
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
    /**
     * Optional model passed through the Agent Template `{{model_shell}}`
     * placeholder (MIK-040). Omitting it preserves current behavior; a non-empty
     * string is required when present. Whether the selected Agent Template
     * supports a model is checked by `create_session` before any side effects.
     */
    model: nonEmptyString.optional(),
    /**
     * Optional Agent Profile id (MIK-041). When present, `create_session`
     * resolves it (project > user > builtin), renders the profile instructions
     * before the user prompt into `prompt.md`, and may apply the profile's
     * `agent`/`model` launch defaults. An unknown id fails with `invalid_input`
     * before any side effects.
     */
    profile: nonEmptyString.optional(),
    cwd: nonEmptyString.optional(),
    parentSessionId: nonEmptyString.optional(),
    root: z.boolean().optional(),
  })
  .strict();
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export interface CreateSessionOutput {
  session: Session;
}

// --- profiles -------------------------------------------------------------

/** Input for listing Agent Profiles; no parameters in MVP. */
export const listProfilesInputSchema = z.object({}).strict();
export type ListProfilesInput = z.infer<typeof listProfilesInputSchema>;

/** Input for fetching one Agent Profile by id. */
export const getProfileInputSchema = z
  .object({
    id: nonEmptyString,
  })
  .strict();
export type GetProfileInput = z.infer<typeof getProfileInputSchema>;

// --- doctor ---------------------------------------------------------------

export const doctorInputSchema = z.object({}).strict();
export type DoctorInput = z.infer<typeof doctorInputSchema>;

export type DoctorConfigStatus =
  | {
      kind: "found";
      configPath: string;
      workspaceId: string;
      defaultAgent: string;
      defaultMux: string;
    }
  | { kind: "not_found" }
  | { kind: "invalid"; configPath: string; issues: readonly string[] };

export interface DoctorExecutableCheck {
  kind: "agent" | "mux";
  template: string;
  executable: string;
  status: "ok" | "missing";
  path: string | null;
  isDefault: boolean;
}

export interface DoctorOutput {
  config: DoctorConfigStatus;
  agents: DoctorExecutableCheck[];
  multiplexers: DoctorExecutableCheck[];
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
export interface AttachCommand {
  argv: string[];
}

export interface GetSessionOutput {
  session: Session;
  attachHint?: string;
  attachCommand?: AttachCommand;
}

// --- close / delete -------------------------------------------------------

export const closeSessionInputSchema = z
  .object({
    id: nonEmptyString,
    force: z.boolean().optional(),
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
