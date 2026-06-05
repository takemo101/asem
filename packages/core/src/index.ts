/**
 * `@asem/core` — the single source of truth for asem domain contracts.
 *
 * Owns: domain types & schemas (Session, Message, Config, Effective Scope),
 * operation input/output contracts, structured errors, port interfaces, and the
 * pure token and shell helpers. Contains no I/O: no SQLite, no real shell, no
 * terminal UI, no MCP transport, no hidden filesystem mutation.
 */

// Shared primitives
export * from "./types/common.ts";

// Domain types & schemas
export * from "./types/scope.ts";
export * from "./types/session.ts";
export * from "./types/message.ts";
export * from "./types/config.ts";

// Structured errors & result envelope
export * from "./types/errors.ts";

// Operation input/output contracts
export * from "./types/operations.ts";

// Port interfaces
export * from "./ports.ts";

// Pure helpers
export * from "./helpers/token.ts";
export * from "./helpers/shell.ts";
