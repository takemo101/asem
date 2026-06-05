#!/usr/bin/env bun
/**
 * `@asem/cli` — the installed `asem` binary and its public projection API.
 *
 * The CLI is a thin surface projection: it parses flags into typed operation
 * inputs, calls shared `@asem/ops` handlers with injected deps, and renders the
 * result. It owns no use-case semantics. The runtime composition root (real
 * SQLite + I/O adapters) is loaded only when this file runs as the binary, so
 * importing the package — and every default test — never pulls in SQLite/shell.
 */
export { runCli, EXIT_OK, EXIT_ERROR, EXIT_USAGE } from "./run.ts";
export type { RunCliOptions } from "./run.ts";
export { parseArgs } from "./parse.ts";
export type { CliCommand, ParseResult } from "./parse.ts";
export { BufferIo, processIo } from "./io.ts";
export type { CliIo } from "./io.ts";

export const PACKAGE_NAME = "@asem/cli";

if (import.meta.main) {
  const { main } = await import("./main.ts");
  process.exit(await main(process.argv.slice(2)));
}
