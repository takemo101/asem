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

export type { ResolvedProfile } from "@asem/profiles";
// Shared resolution / auth helpers
export {
  authenticateCurrentSession,
  type ProjectContext,
  resolveContext,
  sameScope,
} from "./context.ts";
// Dependency bundle & invocation context
export type { OpContext, OpsDeps } from "./deps.ts";
export { closeSession } from "./operations/close-session.ts";
export { createSession } from "./operations/create-session.ts";
export { deleteSession } from "./operations/delete-session.ts";
export { doctor } from "./operations/doctor.ts";
export { getSession } from "./operations/get-session.ts";
// Operation handlers
export { initProject } from "./operations/init-project.ts";
export { initSession } from "./operations/init-session.ts";
export { listMessages } from "./operations/list-messages.ts";
export { listSessions } from "./operations/list-sessions.ts";
export {
  refreshLiveness,
  refreshLivenessAll,
} from "./operations/liveness.ts";
export { peekSession } from "./operations/peek-session.ts";
export {
  type GetProfileOutput,
  getProfile,
  type ListProfilesOutput,
  listProfiles,
} from "./operations/profiles.ts";
export {
  formatMessageBody,
  reportParent,
  sendMessage,
} from "./operations/send-message.ts";
export { waitMessages } from "./operations/wait-messages.ts";
export {
  loadWorkspaceSnapshot,
  type WorkspaceSnapshotOutput,
} from "./operations/workspace-snapshot.ts";
// Runtime path / layout helpers
export {
  configPathFor,
  currentSessionFileFor,
  dirName,
  gitignorePathFor,
  joinPath,
  RUNTIME_GITIGNORE_RULES,
  sessionDirFor,
  TOKEN_FILE_MODE,
  tokenFileFor,
} from "./paths.ts";
export { profileDirsFor } from "./profiles.ts";
export type { OperationError, OperationResult };
