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
  type Clock,
  type Config,
  type ConfigLoader,
  err,
  type FileSystem,
  hashToken,
  type IdGenerator,
  type InitSessionInput,
  type InitSessionOutput,
  initSessionInputSchema,
  type Logger,
  type MuxRef,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Session,
  type Store,
  type TokenGenerator,
} from "@asem/core";
import { resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import {
  currentSessionFileFor,
  dirName,
  sessionDirFor,
  TOKEN_FILE_MODE,
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

/**
 * Required herdr pane coordinates and the muxRef field each maps to. A complete
 * herdr environment exports all of these alongside `HERDR_ENV=1`; they are the
 * coordinates the herdr `send` sequence needs to deliver into the pane.
 */
const HERDR_REQUIRED: ReadonlyArray<{ envVar: string; refKey: string }> = [
  { envVar: "HERDR_SESSION", refKey: "herdr_session" },
  { envVar: "HERDR_WORKSPACE_ID", refKey: "herdr_workspace_id" },
  { envVar: "HERDR_TAB_ID", refKey: "tab_id" },
  { envVar: "HERDR_PANE_ID", refKey: "pane_id" },
];

/**
 * `init-session` registers an already-existing pane/workspace, so asem does not
 * own that mux resource: every stored ref is marked borrowed with
 * `asem_mux_owned = "false"` so close/delete never run the mux close sequence
 * for it (for herdr that could close the operator's whole workspace).
 */
function borrowed(ref: MuxRef): MuxRef {
  return { ...ref, asem_mux_owned: "false" };
}

/**
 * Resolve the Session's stored `mux` + `muxRef` (design "Current Session
 * registration", MIK-049). Explicit caller input is the strongest signal and
 * always wins, including an intentional `mux: none`. Absent an explicit mux, a
 * complete herdr environment safely discovers the pane that already hosts this
 * process. A herdr environment that is indicated but incomplete is a structured
 * actionable error rather than a silent, non-deliverable `mux: none` fallback.
 */
function resolveInitMux(
  input: InitSessionInput,
  config: Config,
  env: Record<string, string | undefined>,
): OperationResult<{ mux: string; muxRef: MuxRef }> {
  const muxRef = input.muxRef ?? {};

  // Explicit input wins (Explicit over Implicit): use it verbatim, including an
  // intentional `mux: none` non-deliverable Session.
  if (input.mux !== undefined) {
    return ok({ mux: input.mux, muxRef: borrowed(muxRef) });
  }

  // Herdr is indicated: discover the current pane from the environment.
  if (env.HERDR_ENV === "1") {
    const derived: Record<string, string> = {};
    const missing: string[] = [];
    for (const { envVar, refKey } of HERDR_REQUIRED) {
      const value = env[envVar];
      if (value === undefined || value === "") {
        missing.push(envVar);
      } else {
        derived[refKey] = value;
      }
    }
    if (missing.length > 0) {
      return err(
        operationError(
          "incomplete_mux_env",
          "herdr environment is indicated (HERDR_ENV=1) but required herdr identifiers are missing; pass explicit --mux/--mux-ref or choose `--mux none` to register a non-deliverable Session intentionally",
          { mux: "herdr", missing },
        ),
      );
    }
    // Explicit muxRef fields override discovered identifiers (input still wins).
    return ok({ mux: "herdr", muxRef: borrowed({ ...derived, ...muxRef }) });
  }

  // No explicit mux and no supported current-mux environment: use the
  // configured default with the provided ref (existing behavior).
  return ok({ mux: config.mux.default, muxRef: borrowed(muxRef) });
}

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

  // Resolve the stored mux + borrowed mux ref before any side effect so an
  // incomplete herdr environment fails with no Session row (MIK-049).
  const muxResolution = resolveInitMux(input, config, ctx.env ?? {});
  if (!muxResolution.ok) {
    return muxResolution;
  }
  const { mux, muxRef } = muxResolution.value;

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
    mux,
    // init-session registers an already-running Session; model selection is a
    // create-time launch concern, so a registered Session has no model (MIK-040).
    model: null,
    // Agent Profiles shape a Session's launch prompt, which init-session does not
    // own (it registers a pane the agent already started), so a registered
    // Session carries no profile (MIK-041).
    profile: null,
    profileSource: null,
    parentSessionId,
    status: "running",
    // Borrowed mux ref (see resolveInitMux): asem did not create this pane, so
    // close/delete must not run the mux close sequence for it. The ownership
    // marker travels in the ref so all surfaces share one semantic without
    // adding schema/storage columns.
    muxRef,
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
