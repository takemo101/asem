import type { Config } from "./types/config.ts";
import type { Message } from "./types/message.ts";
import type {
  MessageListFilter,
  SessionListFilter,
} from "./types/operations.ts";
import type { EffectiveScope } from "./types/scope.ts";
import type { Session, SessionStatus } from "./types/session.ts";

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
  getSessionByName(
    scope: EffectiveScope,
    name: string,
  ): Promise<Session | null>;
  listSessions(
    scope: EffectiveScope,
    filter?: SessionListFilter,
  ): Promise<Session[]>;
  /**
   * List every Session sharing a `workspace_id`, across worktree roots. This is
   * the one sanctioned scope-broadening read (implementation principle 7): the
   * TUI `--scope workspace` view groups the result by `worktree_root`. Normal
   * worktree-isolated operations must use {@link listSessions} instead.
   */
  listSessionsByWorkspace(
    workspaceId: string,
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
  /**
   * List every Message sharing a `workspace_id`, across worktree roots. The
   * workspace-wide companion to {@link listMessages}, used only by the TUI
   * `--scope workspace` view; normal reads stay worktree-isolated.
   */
  listMessagesByWorkspace(
    workspaceId: string,
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
  /**
   * Deterministic handle for a backgrounded process. Set only when the request
   * had `background: true`. Part of the fake runner contract owned by
   * `@asem/runtime`; real runners may also populate it.
   */
  backgroundHandle?: string;
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

/**
 * Builds a {@link TemplateRegistry} for a resolved project {@link Config}.
 *
 * Project-local `mux.templates` / `agent.templates` from `.asem.yaml` are
 * layered over the builtin templates: project-local definitions override a
 * builtin of the same name, and builtins remain available when the project-local
 * maps are empty. The single template resolution path lives in `@asem/runtime`
 * (implementation principle 13); surfaces never parse template definitions
 * themselves. The factory is the seam because the templates an operation may use
 * depend on the config discovered for that operation's `cwd`.
 */
export interface TemplateRegistryFactory {
  forConfig(config: Config): TemplateRegistry;
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

/**
 * Outcome of discovering and parsing `.asem.yaml`.
 *
 * A discriminated result rather than `Config | null` so callers can distinguish
 * "no config found" (`config_not_found`) from "found but unparseable"
 * (`invalid_config`) and surface the right structured error (see
 * implementation principle 1: parse, don't merely check).
 */
export type ConfigDiscovery =
  | { kind: "found"; config: Config; configPath: string }
  | { kind: "not_found" }
  | { kind: "invalid"; configPath: string; issues: readonly string[] };

/** Loads and parses `.asem.yaml`, walking upward from a start directory. */
export interface ConfigLoader {
  load(startDir: string): Promise<ConfigDiscovery>;
}

/** Resolves the Effective Scope for a working directory. */
export interface ScopeResolver {
  resolve(cwd: string, config: Config): Promise<EffectiveScope>;
  /**
   * Resolve only the Worktree Root for a working directory — the same root
   * {@link resolve} embeds in the Effective Scope, but without needing a config.
   * `asem init` uses this so it writes `.asem.yaml`/`.gitignore` at the worktree
   * root (where runtime token-bearing paths later live), not the raw shell cwd.
   */
  resolveWorktreeRoot(cwd: string): Promise<string>;
}

/** A pointer to the current Session plus its raw token for authentication. */
export interface CurrentSessionRef {
  sessionId: string;
  token: string;
  /**
   * Effective Scope the current-session file was registered in, when known.
   * Operations compare it against the freshly resolved scope to detect a
   * `scope_mismatch` (e.g. a stale current-session pointer in another worktree).
   */
  scope?: EffectiveScope;
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
