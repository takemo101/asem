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

function surfaceForArgv(argv: readonly string[]): RuntimeSurface {
  switch (argv[0]) {
    case "mcp":
      return "mcp";
    case "tui":
      return "tui";
    default:
      return "cli";
  }
}

/** Entry point for the installed binary. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const deps = await createRuntimeDeps({ surface: surfaceForArgv(argv) });
  if (argv[0] === "mcp") {
    await runMcpStdio({ cwd: process.cwd(), deps });
    return 0;
  }
  // The TUI needs a real terminal host, so it is launched from the composition
  // root rather than the pure dispatch table (mirroring `asem mcp`).
  if (argv[0] === "tui") {
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
