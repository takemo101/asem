/**
 * Injected dependency bundle for `@asem/ops`.
 *
 * Every operation handler depends only on these `@asem/core` port interfaces —
 * never on concrete SQLite, real shell execution, or terminal UI (architecture
 * rule). Tests substitute fakes for the whole bundle; individual operations
 * accept a `Pick` of the ports they actually use so their needs stay explicit.
 */
import type {
  Clock,
  ConfigLoader,
  CurrentSessionResolver,
  FileSystem,
  IdGenerator,
  LivenessProbe,
  Logger,
  Redactor,
  ScopeResolver,
  Store,
  TemplateRegistry,
  TemplateRunner,
  TokenGenerator,
} from "@asem/core";

/** The full set of ports `@asem/ops` operations may require. */
export interface OpsDeps {
  store: Store;
  fs: FileSystem;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  /** Resolves mux/agent templates (builtin + project-local) by name. */
  templateRegistry: TemplateRegistry;
  /** Executes command-sequence side effects (run/write/wait) for the runtime. */
  templateRunner: TemplateRunner;
  livenessProbe: LivenessProbe;
  clock: Clock;
  idGenerator: IdGenerator;
  tokenGenerator: TokenGenerator;
  logger: Logger;
  redactor: Redactor;
}

/**
 * Runtime environment for an operation invocation. `cwd` drives config
 * discovery and scope resolution; `refreshLiveness` opts a read into a
 * lightweight liveness pass (list/get only).
 */
export interface OpContext {
  cwd: string;
  refreshLiveness?: boolean;
}
