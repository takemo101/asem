/**
 * Binary composition root: build real runtime deps and run one CLI invocation.
 *
 * This is the only place `@asem/cli` touches concrete SQLite and real I/O. It is
 * imported solely by the `index.ts` bin entry (dynamically, under
 * `import.meta.main`), so importing the package for its API — and every default
 * test — stays free of SQLite, shell, and filesystem (testability rules).
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OpsDeps } from "@asem/ops";
import { createTemplateRegistry } from "@asem/runtime";
import { openSqliteStore } from "@asem/store";
import { processIo } from "./io.ts";
import { runCli } from "./run.ts";
import {
  ConsoleLogger,
  FileConfigLoader,
  FileCurrentSessionResolver,
  GitScopeResolver,
  NodeFileSystem,
  NodeTemplateRunner,
  passthroughRedactor,
  randomTokenGenerator,
  storedStatusLivenessProbe,
  systemClock,
  uuidIdGenerator,
} from "./runtime/adapters.ts";

/** Assemble the full {@link OpsDeps} bundle backed by the global SQLite DB. */
export async function createRuntimeDeps(): Promise<OpsDeps> {
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
    // Builtin templates only for now; project-local templates from `.asem.yaml`
    // are layered in by a later slice.
    templateRegistry: createTemplateRegistry(),
    templateRunner: new NodeTemplateRunner(fs),
    livenessProbe: storedStatusLivenessProbe,
    clock: systemClock,
    idGenerator: uuidIdGenerator,
    tokenGenerator: randomTokenGenerator,
    logger: new ConsoleLogger(),
    redactor: passthroughRedactor,
  };
}

/** Entry point for the installed binary. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const deps = await createRuntimeDeps();
  return runCli({ argv, cwd: process.cwd(), deps, io: processIo });
}
