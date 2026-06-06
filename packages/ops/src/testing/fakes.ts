/**
 * In-memory fakes for `@asem/ops` tests.
 *
 * Operation tests run entirely against these — no real SQLite, shell,
 * filesystem, clock, ids, or tokens (testability rules; implementation
 * principle 4). Each fake is small and inspectable so tests can assert on
 * recorded effects (written files + modes, store contents, log entries).
 */
import type {
  Clock,
  Config,
  ConfigDiscovery,
  ConfigLoader,
  CurrentSessionRef,
  CurrentSessionResolver,
  EffectiveScope,
  FileSystem,
  IdGenerator,
  LivenessProbe,
  LogFields,
  Logger,
  Message,
  MessageListFilter,
  Redactor,
  ScopeResolver,
  Session,
  SessionListFilter,
  SessionStatus,
  SessionUpdate,
  Store,
  TemplateRegistry,
  TemplateRunner,
  TokenGenerator,
} from "@asem/core";
import { createTemplateRegistry, FakeTemplateRunner } from "@asem/runtime";
import type { OpsDeps } from "../deps.ts";

// --- FileSystem -----------------------------------------------------------

export interface FakeFile {
  contents: string;
  mode?: number;
}

/** In-memory {@link FileSystem} recording file contents, modes, and dirs. */
export class FakeFileSystem implements FileSystem {
  readonly files = new Map<string, FakeFile>();
  readonly dirs = new Set<string>();
  readonly realpaths = new Map<string, string>();

  async readFile(path: string): Promise<string> {
    const file = this.files.get(path);
    if (file === undefined) {
      throw new Error(`FakeFileSystem: no such file: ${path}`);
    }
    return file.contents;
  }

  async writeFileAtomic(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void> {
    this.files.set(
      path,
      options?.mode === undefined
        ? { contents }
        : { contents, mode: options.mode },
    );
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async mkdirp(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const file = this.files.get(path);
    if (file !== undefined) {
      file.mode = mode;
    }
  }

  async realpath(path: string): Promise<string> {
    return this.realpaths.get(path) ?? path;
  }
}

// --- Store ----------------------------------------------------------------

function inScope(
  row: { workspaceId: string; worktreeRoot: string },
  scope: EffectiveScope,
): boolean {
  return (
    row.workspaceId === scope.workspaceId &&
    row.worktreeRoot === scope.worktreeRoot
  );
}

function byCreatedThenId<T extends { createdAt: string; id: string }>(
  a: T,
  b: T,
): number {
  return a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);
}

/** In-memory {@link Store}. Scope filters mirror the SqliteStore semantics. */
export class FakeStore implements Store {
  readonly sessions: Session[] = [];
  readonly messages: Message[] = [];

  async insertSession(session: Session): Promise<void> {
    const conflict = this.sessions.some(
      (s) =>
        s.workspaceId === session.workspaceId &&
        s.worktreeRoot === session.worktreeRoot &&
        s.name === session.name,
    );
    if (conflict) {
      throw Object.assign(
        new Error("a Session with this name already exists in scope"),
        { code: "session_name_conflict" },
      );
    }
    this.sessions.push({ ...session });
  }

  async getSessionById(
    scope: EffectiveScope,
    id: string,
  ): Promise<Session | null> {
    const found = this.sessions.find((s) => inScope(s, scope) && s.id === id);
    return found ? { ...found } : null;
  }

  async getSessionByName(
    scope: EffectiveScope,
    name: string,
  ): Promise<Session | null> {
    const found = this.sessions.find(
      (s) => inScope(s, scope) && s.name === name,
    );
    return found ? { ...found } : null;
  }

  async listSessions(
    scope: EffectiveScope,
    filter?: SessionListFilter,
  ): Promise<Session[]> {
    return this.sessions
      .filter((s) => inScope(s, scope))
      .filter((s) => filter?.status === undefined || s.status === filter.status)
      .filter((s) => {
        if (filter === undefined || filter.parentSessionId === undefined) {
          return true;
        }
        return s.parentSessionId === filter.parentSessionId;
      })
      .sort(byCreatedThenId)
      .map((s) => ({ ...s }));
  }

  async updateSession(
    scope: EffectiveScope,
    id: string,
    patch: SessionUpdate,
  ): Promise<void> {
    const session = this.sessions.find((s) => inScope(s, scope) && s.id === id);
    if (session === undefined) {
      return;
    }
    if (patch.status !== undefined) session.status = patch.status;
    if (patch.muxRef !== undefined) session.muxRef = patch.muxRef;
    if (patch.updatedAt !== undefined) session.updatedAt = patch.updatedAt;
    if (patch.closedAt !== undefined) session.closedAt = patch.closedAt;
  }

  async deleteSessionScoped(scope: EffectiveScope, id: string): Promise<void> {
    const idx = this.sessions.findIndex(
      (s) => inScope(s, scope) && s.id === id,
    );
    if (idx >= 0) this.sessions.splice(idx, 1);
  }

  async deleteRelatedMessagesScoped(
    scope: EffectiveScope,
    sessionId: string,
  ): Promise<number> {
    let removed = 0;
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const m = this.messages[i]!;
      if (
        inScope(m, scope) &&
        (m.fromSessionId === sessionId || m.toSessionId === sessionId)
      ) {
        this.messages.splice(i, 1);
        removed += 1;
      }
    }
    return removed;
  }

  async insertMessage(message: Message): Promise<void> {
    this.messages.push({ ...message });
  }

  async listMessages(
    scope: EffectiveScope,
    filter?: MessageListFilter,
  ): Promise<Message[]> {
    return this.messages
      .filter((m) => inScope(m, scope))
      .filter(
        (m) =>
          filter?.toSessionId === undefined ||
          m.toSessionId === filter.toSessionId,
      )
      .filter((m) => filter?.undelivered !== true || m.deliveredAt === null)
      .sort(byCreatedThenId)
      .map((m) => ({ ...m }));
  }

  async markMessageDelivered(
    scope: EffectiveScope,
    id: string,
    deliveredAt: string,
  ): Promise<void> {
    const m = this.messages.find((msg) => inScope(msg, scope) && msg.id === id);
    if (m !== undefined) {
      m.deliveredAt = deliveredAt;
      m.deliveryError = null;
    }
  }

  async markMessageDeliveryError(
    scope: EffectiveScope,
    id: string,
    deliveryError: string,
  ): Promise<void> {
    const m = this.messages.find((msg) => inScope(msg, scope) && msg.id === id);
    if (m !== undefined) {
      m.deliveryError = deliveryError;
      m.deliveredAt = null;
    }
  }

  async withTransaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Mirror the SqliteStore's all-or-nothing semantics: snapshot the rows, run
    // the body, and restore on throw so operation tests can assert rollback.
    const sessionSnapshot = this.sessions.map((s) => ({ ...s }));
    const messageSnapshot = this.messages.map((m) => ({ ...m }));
    try {
      return await fn(this);
    } catch (error) {
      this.sessions.splice(0, this.sessions.length, ...sessionSnapshot);
      this.messages.splice(0, this.messages.length, ...messageSnapshot);
      throw error;
    }
  }
}

// --- Config / scope / current session -------------------------------------

/** Default `.asem.yaml`-shaped config for tests. */
export function makeConfig(overrides?: Partial<Config>): Config {
  return {
    workspace: { id: "ws_1" },
    mux: { default: "herdr", templates: {} },
    agent: { default: "claude", templates: {} },
    ...overrides,
  };
}

/** Configurable {@link ConfigLoader}; defaults to a found config at `cwd`. */
export class FakeConfigLoader implements ConfigLoader {
  result: ConfigDiscovery;

  constructor(result?: ConfigDiscovery) {
    this.result =
      result ??
      ({
        kind: "found",
        config: makeConfig(),
        configPath: "/repo/.asem.yaml",
      } satisfies ConfigDiscovery);
  }

  async load(): Promise<ConfigDiscovery> {
    return this.result;
  }
}

/** Resolves a fixed scope (defaults to `cwd` as worktree root). */
export class FakeScopeResolver implements ScopeResolver {
  scope?: EffectiveScope;

  constructor(scope?: EffectiveScope) {
    this.scope = scope;
  }

  async resolve(cwd: string, config: Config): Promise<EffectiveScope> {
    return (
      this.scope ?? {
        workspaceId: config.workspace.id,
        worktreeRoot: cwd,
      }
    );
  }
}

/** Returns a configurable current-session ref (or `null`). */
export class FakeCurrentSessionResolver implements CurrentSessionResolver {
  ref: CurrentSessionRef | null;

  constructor(ref: CurrentSessionRef | null = null) {
    this.ref = ref;
  }

  async resolve(): Promise<CurrentSessionRef | null> {
    return this.ref;
  }
}

/** Scripts a liveness status per Session id; defaults to the stored status. */
export class FakeLivenessProbe implements LivenessProbe {
  readonly statuses = new Map<string, SessionStatus>();
  readonly probed: string[] = [];

  set(id: string, status: SessionStatus): this {
    this.statuses.set(id, status);
    return this;
  }

  async check(session: Session): Promise<SessionStatus> {
    this.probed.push(session.id);
    return this.statuses.get(session.id) ?? session.status;
  }
}

// --- Clock / id / token ---------------------------------------------------

/** Fixed (optionally advancing) {@link Clock}. */
export class FakeClock implements Clock {
  private current: Date;
  private readonly stepMs: number;

  constructor(iso = "2026-06-05T12:00:00.000Z", stepMs = 0) {
    this.current = new Date(iso);
    this.stepMs = stepMs;
  }

  now(): Date {
    const value = new Date(this.current);
    this.current = new Date(this.current.getTime() + this.stepMs);
    return value;
  }

  nowIso(): string {
    return this.now().toISOString();
  }
}

/** Deterministic incrementing id generator. */
export class FakeIdGenerator implements IdGenerator {
  private n = 0;

  constructor(private readonly prefix = "s") {}

  nextId(): string {
    this.n += 1;
    return `${this.prefix}_${String(this.n).padStart(4, "0")}`;
  }
}

/** Deterministic incrementing token generator. */
export class FakeTokenGenerator implements TokenGenerator {
  private n = 0;

  constructor(private readonly prefix = "tok") {}

  generate(): string {
    this.n += 1;
    return `${this.prefix}_${String(this.n).padStart(4, "0")}`;
  }
}

// --- Logger / redactor ----------------------------------------------------

export interface LogEntry {
  level: keyof Logger;
  message: string;
  fields?: LogFields;
}

/** Records log entries for assertions. */
export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  private record(level: keyof Logger) {
    return (message: string, fields?: LogFields): void => {
      this.entries.push(
        fields === undefined ? { level, message } : { level, message, fields },
      );
    };
  }

  debug = this.record("debug");
  info = this.record("info");
  warn = this.record("warn");
  error = this.record("error");
}

/** Identity {@link Redactor}; redaction itself is exercised in `@asem/runtime`. */
export const noopRedactor: Redactor = { redact: (value) => value };

// --- Bundle ---------------------------------------------------------------

/**
 * A {@link TemplateRegistry} backed by the runtime's builtin templates. The
 * registry/sequence-execution logic itself is exercised in `@asem/runtime`;
 * operation tests only need a real resolution path for `herdr`/`claude`.
 */
export function makeTemplateRegistry(): TemplateRegistry {
  return createTemplateRegistry();
}

/** A fresh fake {@link TemplateRunner} (records command/write/wait traces). */
export function makeTemplateRunner(): TemplateRunner {
  return new FakeTemplateRunner();
}

/** Build a full {@link OpsDeps} bundle of fakes; override any port per test. */
export function makeOpsDeps(overrides: Partial<OpsDeps> = {}): OpsDeps {
  return {
    store: new FakeStore(),
    fs: new FakeFileSystem(),
    configLoader: new FakeConfigLoader(),
    scopeResolver: new FakeScopeResolver(),
    currentSessionResolver: new FakeCurrentSessionResolver(),
    templateRegistry: makeTemplateRegistry(),
    templateRunner: makeTemplateRunner(),
    livenessProbe: new FakeLivenessProbe(),
    clock: new FakeClock(),
    idGenerator: new FakeIdGenerator(),
    tokenGenerator: new FakeTokenGenerator(),
    logger: new MemoryLogger(),
    redactor: noopRedactor,
    ...overrides,
  };
}
