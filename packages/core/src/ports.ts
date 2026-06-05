import type { Config } from "./types/config.ts";
import type { EffectiveScope } from "./types/scope.ts";
import type { Session, SessionStatus } from "./types/session.ts";
import type { Message } from "./types/message.ts";
import type {
  SessionListFilter,
  MessageListFilter,
} from "./types/operations.ts";

/**
 * Port interfaces required by future operation handlers (`@asem/ops`).
 *
 * `@asem/core` owns the contracts only; concrete implementations (SQLite,
 * real shell, real filesystem, terminal UI) live in their own packages and are
 * injected. Operation tests substitute fakes for every port so default tests
 * never touch real SQLite, shells, multiplexers, agent CLIs, MCP, or the TUI.
 */

/** Fields of a Session that may be patched after creation. */
export type SessionUpdate = Partial<
  Pick<Session, "status" | "muxRef" | "updatedAt" | "closedAt">
>;

/**
 * Persistence port. All normal queries are scoped by Effective Scope. Use-case
 * semantics (e.g. when a delete removes related messages) live in `@asem/ops`,
 * not here; the Store only exposes scoped primitives.
 */
export interface Store {
  insertSession(session: Session): Promise<void>;
  getSessionById(scope: EffectiveScope, id: string): Promise<Session | null>;
  getSessionByName(scope: EffectiveScope, name: string): Promise<Session | null>;
  listSessions(
    scope: EffectiveScope,
    filter?: SessionListFilter,
  ): Promise<Session[]>;
  updateSession(
    scope: EffectiveScope,
    id: string,
    patch: SessionUpdate,
  ): Promise<void>;
  deleteSessionScoped(scope: EffectiveScope, id: string): Promise<void>;
  deleteRelatedMessagesScoped(
    scope: EffectiveScope,
    sessionId: string,
  ): Promise<number>;
  insertMessage(message: Message): Promise<void>;
  listMessages(
    scope: EffectiveScope,
    filter?: MessageListFilter,
  ): Promise<Message[]>;
  markMessageDelivered(
    scope: EffectiveScope,
    id: string,
    deliveredAt: string,
  ): Promise<void>;
  markMessageDeliveryError(
    scope: EffectiveScope,
    id: string,
    deliveryError: string,
  ): Promise<void>;
  withTransaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;
}

/** A single command-runner invocation request. */
export interface CommandRequest {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  background?: boolean;
}

/** Result of a command-runner invocation. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Low-level command execution seam. Real shells and the fake runner are
 * interchangeable behind this port.
 */
export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

/**
 * Runtime port used to execute template command sequences. Extends the
 * low-level runner with the side effects a sequence step may perform.
 */
export interface TemplateRunner extends CommandRunner {
  writeFile(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** Resolves and provides multiplexer / agent templates. */
export interface TemplateRegistry {
  getMuxTemplate(name: string): unknown | undefined;
  getAgentTemplate(name: string): unknown | undefined;
}

/** Filesystem seam with atomic, mode-aware writes for Session-local files. */
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFileAtomic(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdirp(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<string>;
}

/** Loads and parses `.asem.yaml`, walking upward from a start directory. */
export interface ConfigLoader {
  load(
    startDir: string,
  ): Promise<{ config: Config; configPath: string } | null>;
}

/** Resolves the Effective Scope for a working directory. */
export interface ScopeResolver {
  resolve(cwd: string, config: Config): Promise<EffectiveScope>;
}

/** A pointer to the current Session plus its raw token for authentication. */
export interface CurrentSessionRef {
  sessionId: string;
  token: string;
}

/** Resolves the current Session within a scope (env or current-session file). */
export interface CurrentSessionResolver {
  resolve(scope: EffectiveScope): Promise<CurrentSessionRef | null>;
}

/** Lightweight liveness check for a Session's multiplexer pane. */
export interface LivenessProbe {
  check(session: Session): Promise<SessionStatus>;
}

/** Time seam for deterministic tests. */
export interface Clock {
  now(): Date;
  nowIso(): string;
}

/** Identifier seam for deterministic tests. */
export interface IdGenerator {
  nextId(): string;
}

/** High-entropy Session token seam. Raw tokens are never persisted. */
export interface TokenGenerator {
  generate(): string;
}

/** Redacts secret material (tokens) from strings before logging/returning. */
export interface Redactor {
  redact(value: string): string;
}

export type LogFields = Record<string, unknown>;

/** Structured logger seam. Implementations must redact token material. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
