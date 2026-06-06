/**
 * `load_workspace_snapshot` operation — the workspace-wide read for the TUI
 * `--scope workspace` cockpit view.
 *
 * This is the one operation that intentionally broadens past worktree isolation:
 * it lists every Session and Message sharing the resolved `workspace_id`, across
 * worktree roots, so the cockpit can group them by `worktree_root` (design
 * "Scope resolution"; implementation principle 7). Worktree-isolated reads keep
 * using `list_sessions` / `list_messages`. The scope broadening is confined to
 * this helper and the two `*ByWorkspace` Store primitives — callsites never drop
 * the worktree filter ad hoc.
 */
import {
  type ConfigLoader,
  type Message,
  type OperationResult,
  ok,
  type ScopeResolver,
  type Session,
  type Store,
} from "@asem/core";
import { resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";

type WorkspaceSnapshotDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
};

/** Workspace-wide Sessions and Messages for the current `workspace_id`. */
export interface WorkspaceSnapshotOutput {
  sessions: Session[];
  messages: Message[];
}

export async function loadWorkspaceSnapshot(
  deps: WorkspaceSnapshotDeps,
  ctx: OpContext,
): Promise<OperationResult<WorkspaceSnapshotOutput>> {
  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { scope } = contextResult.value;

  const sessions = await deps.store.listSessionsByWorkspace(scope.workspaceId);
  const messages = await deps.store.listMessagesByWorkspace(scope.workspaceId);
  return ok({ sessions, messages });
}
