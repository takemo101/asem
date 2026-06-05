/**
 * `init_session` operation — register the already-running current agent Session.
 *
 * Generates a high-entropy token, persists only its hash in the Store, and keeps
 * the raw token out of the database: it is returned once for the caller to
 * export and written to a mode-0600 token file under an ignored path. A
 * non-secret `current-session.json` pointer records identity + scope and points
 * at the token file (design "Current Session registration"; implementation
 * principle 8).
 */
import {
  err,
  hashToken,
  ok,
  initSessionInputSchema,
  operationError,
  type Clock,
  type ConfigLoader,
  type FileSystem,
  type IdGenerator,
  type InitSessionInput,
  type InitSessionOutput,
  type Logger,
  type OperationResult,
  type ScopeResolver,
  type Session,
  type Store,
  type TokenGenerator,
} from "@asem/core";
import type { OpContext } from "../deps.ts";
import { resolveContext } from "../context.ts";
import {
  TOKEN_FILE_MODE,
  currentSessionFileFor,
  dirName,
  sessionDirFor,
  tokenFileFor,
} from "../paths.ts";

type InitSessionDeps = {
  store: Store;
  fs: FileSystem;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  clock: Clock;
  idGenerator: IdGenerator;
  tokenGenerator: TokenGenerator;
  logger?: Logger;
};

/** Duck-typed check for the store's recoverable name-conflict error. */
function isNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "session_name_conflict"
  );
}

export async function initSession(
  deps: InitSessionDeps,
  rawInput: InitSessionInput,
  ctx: OpContext,
): Promise<OperationResult<InitSessionOutput>> {
  const parsed = initSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid init-session input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const input = parsed.data;

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, scope } = contextResult.value;

  // Verify an explicit parent (when given) lives in the same Effective Scope.
  const parentSessionId = input.parentSessionId ?? null;
  if (parentSessionId !== null) {
    const parent = await deps.store.getSessionById(scope, parentSessionId);
    if (parent === null) {
      return err(
        operationError(
          "parent_session_not_found",
          "parent Session not found in this scope",
          { parentSessionId },
        ),
      );
    }
  }

  const id = deps.idGenerator.nextId();
  const token = deps.tokenGenerator.generate();
  const now = deps.clock.nowIso();
  const session: Session = {
    id,
    workspaceId: scope.workspaceId,
    worktreeRoot: scope.worktreeRoot,
    name: input.name,
    cwd: ctx.cwd,
    agent: input.agent ?? config.agent.default,
    mux: input.mux ?? config.mux.default,
    parentSessionId,
    status: "running",
    muxRef: input.muxRef,
    sessionDir: sessionDirFor(scope.worktreeRoot, id),
    tokenHash: hashToken(token),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };

  try {
    await deps.store.insertSession(session);
  } catch (error) {
    if (isNameConflict(error)) {
      return err(
        operationError(
          "session_name_conflict",
          "a Session with this name already exists in scope",
          { name: input.name },
        ),
      );
    }
    throw error;
  }

  // Token-bearing material lives only in a mode-0600 file under an ignored path.
  const tokenFile = tokenFileFor(scope.worktreeRoot, id);
  await deps.fs.mkdirp(dirName(tokenFile));
  await deps.fs.writeFileAtomic(tokenFile, token, { mode: TOKEN_FILE_MODE });

  // Non-secret pointer: identity + scope + token-file location, no raw token.
  const currentSessionFile = currentSessionFileFor(scope.worktreeRoot);
  await deps.fs.mkdirp(dirName(currentSessionFile));
  await deps.fs.writeFileAtomic(
    currentSessionFile,
    `${JSON.stringify(
      {
        sessionId: id,
        name: session.name,
        workspaceId: scope.workspaceId,
        worktreeRoot: scope.worktreeRoot,
        tokenFile,
        createdAt: now,
      },
      null,
      2,
    )}\n`,
  );

  deps.logger?.info("registered current Session", {
    sessionId: id,
    name: session.name,
  });

  return ok({ session, token });
}
