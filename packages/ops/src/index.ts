/**
 * `@asem/ops` — shared operation handlers, auth/scope checks, use-case
 * semantics, and operation-level cleanup.
 *
 * The single semantic boundary: CLI/MCP/TUI surfaces parse input, call these
 * handlers, and render results — they never duplicate this logic. Every handler
 * uses only injected `@asem/core` ports (Store, FileSystem, ConfigLoader, …);
 * it must not import concrete SQLite, real shell, or terminal UI.
 *
 * MIK-004 baseline handlers: project init, current-Session registration, scoped
 * Session reads, and Message history reads.
 */
import type { OperationError, OperationResult } from "@asem/core";

export const PACKAGE_NAME = "@asem/ops";

export type { OperationError, OperationResult };

// Dependency bundle & invocation context
export type { OpsDeps, OpContext } from "./deps.ts";

// Shared resolution / auth helpers
export {
  resolveContext,
  authenticateCurrentSession,
  sameScope,
  type ProjectContext,
} from "./context.ts";

// Runtime path / layout helpers
export {
  RUNTIME_GITIGNORE_RULES,
  TOKEN_FILE_MODE,
  configPathFor,
  currentSessionFileFor,
  dirName,
  gitignorePathFor,
  joinPath,
  sessionDirFor,
  tokenFileFor,
} from "./paths.ts";

// Operation handlers
export { initProject } from "./operations/init-project.ts";
export { initSession } from "./operations/init-session.ts";
export { createSession } from "./operations/create-session.ts";
export { listSessions } from "./operations/list-sessions.ts";
export { getSession } from "./operations/get-session.ts";
export { listMessages } from "./operations/list-messages.ts";
export {
  sendMessage,
  reportParent,
  formatMessageBody,
} from "./operations/send-message.ts";
export {
  refreshLiveness,
  refreshLivenessAll,
} from "./operations/liveness.ts";
