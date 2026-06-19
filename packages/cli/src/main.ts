/**
 * Binary composition root: build real runtime deps and run one CLI invocation.
 *
 * This is the only place `@asem/cli` touches concrete SQLite and real I/O. It is
 * imported solely by the `index.ts` bin entry (dynamically, under
 * `import.meta.main`), so importing the package for its API — and every default
 * test — stays free of SQLite, shell, and filesystem (testability rules).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AttachCommand } from "@asem/core";
import { runMcpStdio } from "@asem/mcp";
import type { OpsDeps } from "@asem/ops";
import { createTemplateRegistryFactory } from "@asem/runtime";
import { openSqliteStore } from "@asem/store";
import { processIo } from "./io.ts";
import { runCli } from "./run.ts";
import {
  bunExecutableResolver,
  createSurfaceLogger,
  FileConfigLoader,
  FileCurrentSessionResolver,
  GitScopeResolver,
  NodeFileSystem,
  NodeTemplateRunner,
  passthroughRedactor,
  type RuntimeSurface,
  randomTokenGenerator,
  storedStatusLivenessProbe,
  systemClock,
  systemHostPaths,
  uuidIdGenerator,
} from "./runtime/adapters.ts";
import { runTuiCommand } from "./tui.ts";

export interface RuntimeDepsOptions {
  surface: RuntimeSurface;
}

/** Assemble the full {@link OpsDeps} bundle backed by the global SQLite DB. */
export async function createRuntimeDeps(
  options: RuntimeDepsOptions,
): Promise<OpsDeps> {
  // Durable state lives in one global database (ADR 0001).
  const dbPath = join(homedir(), ".asem", "state.db");
  await mkdir(dirname(dbPath), { recursive: true });

  const fs = new NodeFileSystem();
  return {
    store: openSqliteStore({ path: dbPath }),
    fs,
    configLoader: new FileConfigLoader(fs),
    scopeResolver: new GitScopeResolver(fs),
    currentSessionResolver: new FileCurrentSessionResolver(fs),
    // Layers each operation cwd's project-local `.asem.yaml` mux/agent templates
    // over the builtins through the one `@asem/runtime` resolution path; builtins
    // stay available when the project-local maps are empty.
    templateRegistryFactory: createTemplateRegistryFactory(),
    templateRunner: new NodeTemplateRunner(fs),
    hostPaths: systemHostPaths,
    executableResolver: bunExecutableResolver,
    livenessProbe: storedStatusLivenessProbe,
    clock: systemClock,
    idGenerator: uuidIdGenerator,
    tokenGenerator: randomTokenGenerator,
    logger: createSurfaceLogger(options.surface, {
      redactor: passthroughRedactor,
    }),
    redactor: passthroughRedactor,
  };
}

function unavailablePort<T extends object>(label: string): T {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} is unavailable in read-only CLI deps`);
      },
    },
  ) as T;
}

/**
 * Assemble deps for commands that do not need durable state. This keeps
 * `asem doctor` and help requests read-only: they do not create ~/.asem or open
 * the SQLite store just to render diagnostics/help.
 */
export function createReadOnlyCliDeps(options: RuntimeDepsOptions): OpsDeps {
  const fs = new NodeFileSystem();
  return {
    store: unavailablePort<OpsDeps["store"]>("store"),
    fs,
    configLoader: new FileConfigLoader(fs),
    scopeResolver: unavailablePort<OpsDeps["scopeResolver"]>("scopeResolver"),
    currentSessionResolver: unavailablePort<OpsDeps["currentSessionResolver"]>(
      "currentSessionResolver",
    ),
    templateRegistryFactory: unavailablePort<
      OpsDeps["templateRegistryFactory"]
    >("templateRegistryFactory"),
    templateRunner:
      unavailablePort<OpsDeps["templateRunner"]>("templateRunner"),
    hostPaths: unavailablePort<OpsDeps["hostPaths"]>("hostPaths"),
    executableResolver: bunExecutableResolver,
    livenessProbe: unavailablePort<OpsDeps["livenessProbe"]>("livenessProbe"),
    clock: unavailablePort<OpsDeps["clock"]>("clock"),
    idGenerator: unavailablePort<OpsDeps["idGenerator"]>("idGenerator"),
    tokenGenerator:
      unavailablePort<OpsDeps["tokenGenerator"]>("tokenGenerator"),
    logger: createSurfaceLogger(options.surface, {
      redactor: passthroughRedactor,
    }),
    redactor: passthroughRedactor,
  };
}

function runAttachCommand(command: AttachCommand): Promise<number> {
  const [program, ...args] = command.argv;
  if (program === undefined) {
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Map a CLI invocation to its runtime surface so the composition root can pick
 * the surface-appropriate logger (ADR 0006): `asem mcp` -> `mcp`, `asem tui` ->
 * `tui`, every other command -> `cli`. Pure so the mapping is unit-testable
 * without building real deps.
 */
export function surfaceForArgv(argv: readonly string[]): RuntimeSurface {
  switch (argv[0]) {
    case "mcp":
      // Only the bare `asem mcp` server runs on the mcp surface; `asem mcp add`
      // is a local-config CLI command, so it stays on the cli surface.
      return argv[1] === undefined ? "mcp" : "cli";
    case "tui":
      return "tui";
    default:
      return "cli";
  }
}

/**
 * True for commands that must not open the durable SQLite store: help, `doctor`,
 * and the Integration Target setup commands (`mcp add`, `skills add`). These run
 * on {@link createReadOnlyCliDeps} so setup never creates ~/.asem or opens
 * state.db just to write a target's local config. The bare `asem mcp` server is
 * excluded — it needs full runtime deps.
 */
export function isReadOnlyCommand(argv: readonly string[]): boolean {
  if (wantsHelp(argv)) return true;
  if (isVersionRequest(argv)) return true;
  if (argv[0] === "doctor") return true;
  if (argv[0] === "skills") return true;
  if (argv[0] === "mcp" && argv[1] === "add") return true;
  // `workspace repo list` only reads `.asem.yaml` and the filesystem; it never
  // touches Session state, so it stays off the durable SQLite store.
  if (argv[0] === "workspace") return true;
  return false;
}

/**
 * True when any token requests help (`--help`, `-h`, or `help`). Used to let
 * `asem mcp --help` / `asem tui --help` fall through to the pure help renderer
 * instead of starting the server or cockpit.
 */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--help" || arg === "-h" || arg === "help");
}

function isVersionRequest(argv: readonly string[]): boolean {
  return argv[0] === "--version" || argv[0] === "-v";
}

/** Entry point for the installed binary. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const surface = surfaceForArgv(argv);
  const deps = isReadOnlyCommand(argv)
    ? createReadOnlyCliDeps({ surface })
    : await createRuntimeDeps({ surface });
  // Only the bare `asem mcp` invocation starts the stdio server. `asem mcp add`
  // falls through to runCli as a local-config command, and `asem mcp --help`
  // falls through to the pure help path so it prints focused help.
  if (argv[0] === "mcp" && argv[1] === undefined && !wantsHelp(argv)) {
    await runMcpStdio({ cwd: process.cwd(), deps, env: process.env });
    return 0;
  }
  // The TUI needs a real terminal host, so it is launched from the composition
  // root rather than the pure dispatch table (mirroring `asem mcp`).
  if (argv[0] === "tui" && !wantsHelp(argv)) {
    return runTuiCommand({
      args: argv.slice(1),
      cwd: process.cwd(),
      deps,
      io: processIo,
    });
  }
  return runCli({
    argv,
    cwd: process.cwd(),
    deps,
    io: processIo,
    attachRunner: runAttachCommand,
  });
}
