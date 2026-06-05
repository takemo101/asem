/**
 * `@asem/ops` — shared operation handlers, auth/scope checks, use-case
 * semantics, and operation-level cleanup.
 *
 * Scaffold only (MIK-001). Handlers land in a later slice. `@asem/ops` uses
 * only injected ports from `@asem/core` (Store, TemplateRunner, FileSystem,
 * etc.) and must not import concrete SQLite, real shell, or terminal UI. It is
 * the single semantic boundary; CLI/MCP/TUI must not duplicate its logic.
 */
import type { OperationResult, OperationError } from "@asem/core";

export const PACKAGE_NAME = "@asem/ops";

export type { OperationResult, OperationError };
