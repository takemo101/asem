/**
 * `create_session` operation — launch a new agent Session end-to-end.
 *
 * This is one of asem's most important correctness boundaries (implementation
 * principle 5: never persist failed create rows). The flow is strictly ordered:
 *
 *   1. resolve config / scope;
 *   2. resolve the parent (truth table below);
 *   3. resolve mux + agent templates (fail fast, no side effects);
 *   4. create the Session dir under `.asem/sessions/<id>/`;
 *   5. write `prompt.md` (always, for audit/debug);
 *   6. run the mux `create` sequence and capture mux refs;
 *   7. generate the launch script with env + agent command;
 *   8. run the mux `run_in_pane` sequence to start it;
 *   9. insert the Session row — only after a successful start.
 *
 * If any step before the insert fails, the operation returns a structured error
 * carrying the Session-dir log path and makes a best-effort attempt to run the
 * mux `close` sequence. No failed Session row is ever left in the Store.
 *
 * The raw token never enters the Store, logs, or structured errors: only its
 * hash is persisted, and the raw value lives solely inside the mode-0600 launch
 * script under the ignored `.asem/sessions/` path (ADR 0001; principle 8).
 */
import {
  type Clock,
  type ConfigLoader,
  type CreateSessionInput,
  type CreateSessionOutput,
  type CurrentSessionResolver,
  createSessionInputSchema,
  type EffectiveScope,
  err,
  type FileSystem,
  hashToken,
  type IdGenerator,
  type Logger,
  type OperationError,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
  type Session,
  type Store,
  shellEscape,
  type TemplateRegistryFactory,
  type TemplateRunner,
  type TokenGenerator,
  verifyToken,
} from "@asem/core";
import {
  type AgentTemplate,
  agentTemplateSchema,
  type CommandSequence,
  createRedactor,
  type MuxTemplate,
  muxTemplateSchema,
  renderAgentCommand,
  SequenceEngine,
} from "@asem/runtime";
import { resolveContext, sameScope } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { joinPath, sessionDirFor, TOKEN_FILE_MODE } from "../paths.ts";

type CreateSessionDeps = {
  store: Store;
  fs: FileSystem;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  templateRegistryFactory: TemplateRegistryFactory;
  templateRunner: TemplateRunner;
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

/** Re-tag a structured error with the Session-dir log path for debugging. */
function withLogPath(error: OperationError, logPath: string): OperationError {
  return operationError(error.code, error.message, {
    ...(error.details ?? {}),
    logPath,
  });
}

/**
 * Render the Session launch script. Env injection is centralized here so the
 * raw token never leaks through command-line args, pane labels, or shell
 * history — it lives only in this mode-0600 file (design "Launch script
 * standard"). `AS_PROJECT_ROOT` is an optional alias for the worktree root.
 */
function buildLaunchScript(params: {
  env: Record<string, string>;
  cwd: string;
  agentCommand: string;
}): string {
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""];
  for (const [key, value] of Object.entries(params.env)) {
    lines.push(`export ${key}=${shellEscape(value)}`);
  }
  lines.push("");
  lines.push(`cd ${shellEscape(params.cwd)}`);
  lines.push(params.agentCommand);
  lines.push("");
  return lines.join("\n");
}

export async function createSession(
  deps: CreateSessionDeps,
  rawInput: CreateSessionInput,
  ctx: OpContext,
): Promise<OperationResult<CreateSessionOutput>> {
  const parsed = createSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid create-session input", {
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
  const cwd = input.cwd ?? ctx.cwd;

  // Fail fast on a same-scope name collision before any side effects so a
  // doomed create never spawns an orphan pane.
  const existing = await deps.store.getSessionByName(scope, input.name);
  if (existing !== null) {
    return err(
      operationError(
        "session_name_conflict",
        "a Session with this name already exists in scope",
        { name: input.name },
      ),
    );
  }

  // --- Parent resolution truth table --------------------------------------
  const parentResult = await resolveParent(deps, scope, input);
  if (!parentResult.ok) {
    return parentResult;
  }
  const parentSessionId = parentResult.value;

  // --- Resolve templates (fail fast, before any filesystem side effects) ---
  // Layer this config's project-local templates over the builtins, so a
  // `.asem.yaml` mux/agent definition resolves through the same typed path.
  const templateRegistry = deps.templateRegistryFactory.forConfig(config);
  const mux = input.mux ?? config.mux.default;
  const agent = input.agent ?? config.agent.default;

  const rawMux = templateRegistry.getMuxTemplate(mux);
  if (rawMux === undefined) {
    return err(
      operationError("mux_template_not_found", "mux template not found", {
        mux,
      }),
    );
  }
  const rawAgent = templateRegistry.getAgentTemplate(agent);
  if (rawAgent === undefined) {
    return err(
      operationError("agent_template_not_found", "agent template not found", {
        agent,
      }),
    );
  }
  const muxTemplate: MuxTemplate = muxTemplateSchema.parse(rawMux);
  const agentTemplate: AgentTemplate = agentTemplateSchema.parse(rawAgent);

  // --- Identity, token, and runtime layout --------------------------------
  const id = deps.idGenerator.nextId();
  const token = deps.tokenGenerator.generate();
  const now = deps.clock.nowIso();
  const sessionDir = sessionDirFor(scope.worktreeRoot, id);
  const promptPath = joinPath(sessionDir, "prompt.md");
  const launchScriptPath = joinPath(sessionDir, "launch.sh");

  // A redactor scoped to this token guarantees the raw value is masked if it
  // ever reaches a sequence error or log line (principle 8).
  const redactor = createRedactor([token]);
  const engine = new SequenceEngine({
    runner: deps.templateRunner,
    redactor,
    logger: deps.logger,
  });

  const baseVars: Record<string, string> = {
    session_id: id,
    parent_session_id: parentSessionId ?? "",
    workspace_id: scope.workspaceId,
    worktree_root: scope.worktreeRoot,
    cwd,
    name: input.name,
    agent,
    mux,
    session_dir: sessionDir,
    prompt_path: promptPath,
    launch_script: launchScriptPath,
    launch_cmd: `bash ${shellEscape(launchScriptPath)}`,
  };

  // Step 4 & 5: create the Session dir and always write prompt.md.
  await deps.fs.mkdirp(sessionDir);
  await deps.fs.writeFileAtomic(
    promptPath,
    ensureTrailingNewline(input.prompt),
  );

  // Step 6: run the mux `create` sequence and capture mux refs.
  const createResult = await engine.run(muxTemplate.create, {
    cwd,
    variables: baseVars,
  });
  if (!createResult.ok) {
    await attemptMuxCleanup(engine, muxTemplate.close, baseVars, cwd, deps);
    deps.logger?.error("mux create failed", {
      sessionId: id,
      code: createResult.error.code,
    });
    return err(withLogPath(createResult.error, sessionDir));
  }
  const muxRef = createResult.value.captures;
  const runVars: Record<string, string> = { ...baseVars, ...muxRef };

  // Step 7: generate the launch script (after mux create) with env + agent
  // command. It is token-bearing, so it is written mode 0600.
  const launchScript = buildLaunchScript({
    env: {
      AS_SESSION_ID: id,
      AS_PARENT_SESSION_ID: parentSessionId ?? "",
      AS_WORKSPACE_ID: scope.workspaceId,
      AS_WORKTREE_ROOT: scope.worktreeRoot,
      AS_PROJECT_ROOT: scope.worktreeRoot,
      AS_SESSION_TOKEN: token,
    },
    cwd,
    agentCommand: renderAgentCommand(agentTemplate, promptPath),
  });
  await deps.fs.writeFileAtomic(launchScriptPath, launchScript, {
    mode: TOKEN_FILE_MODE,
  });

  // Step 8: run the mux `run_in_pane` sequence to start the launch script.
  const runResult = await engine.run(muxTemplate.run_in_pane, {
    cwd,
    variables: runVars,
  });
  if (!runResult.ok) {
    await attemptMuxCleanup(engine, muxTemplate.close, runVars, cwd, deps);
    deps.logger?.error("mux run_in_pane failed", {
      sessionId: id,
      code: runResult.error.code,
    });
    return err(withLogPath(runResult.error, sessionDir));
  }

  // Step 9: insert the Session row — only now, after a successful start.
  const session: Session = {
    id,
    workspaceId: scope.workspaceId,
    worktreeRoot: scope.worktreeRoot,
    name: input.name,
    cwd,
    agent,
    mux,
    parentSessionId,
    status: "running",
    muxRef,
    sessionDir,
    tokenHash: hashToken(token),
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };

  try {
    await deps.store.insertSession(session);
  } catch (error) {
    if (isNameConflict(error)) {
      // Lost a race for the name after starting: clean up the pane we created
      // and surface the conflict. Still no Session row is persisted.
      await attemptMuxCleanup(engine, muxTemplate.close, runVars, cwd, deps);
      return err(
        operationError(
          "session_name_conflict",
          "a Session with this name already exists in scope",
          { name: input.name, logPath: sessionDir },
        ),
      );
    }
    throw error;
  }

  deps.logger?.info("created Session", {
    sessionId: id,
    name: input.name,
    parentSessionId,
  });

  return ok({ session });
}

/**
 * Resolve the parent Session id per the design truth table:
 *
 * | Input                                   | Parent behavior                         |
 * |-----------------------------------------|-----------------------------------------|
 * | `--root` / `--no-parent`                | root Session (`null`)                   |
 * | `--parent <id>`                         | explicit parent, verified in scope      |
 * | no flag + current Session exists        | verified current Session as parent      |
 * | no flag + no current Session            | `current_session_not_found`             |
 *
 * Explicit `--parent <id>` is a human/local-trust selection and is only checked
 * for scope membership. The implicit no-flag path instead adopts the *current*
 * Session as parent, which the design treats as a verified-current-Session
 * operation: its token is verified against the stored hash before it is used, so
 * a stale/forged current-session pointer fails with `invalid_session_token`
 * before any filesystem/mux/store side effects (MIK-023).
 */
async function resolveParent(
  deps: Pick<CreateSessionDeps, "store" | "currentSessionResolver">,
  scope: EffectiveScope,
  input: CreateSessionInput,
): Promise<OperationResult<string | null>> {
  if (input.root === true) {
    return ok(null);
  }

  if (input.parentSessionId !== undefined) {
    const parent = await deps.store.getSessionById(
      scope,
      input.parentSessionId,
    );
    if (parent === null) {
      return err(
        operationError(
          "parent_session_not_found",
          "parent Session not found in this scope",
          { parentSessionId: input.parentSessionId },
        ),
      );
    }
    return ok(parent.id);
  }

  // No parent flag: fall back to the current Session. Adopting the current
  // Session implicitly is a verified-current-Session operation, so its token is
  // verified before use — and because resolveParent runs before any filesystem,
  // mux, or store side effects, a bad token fails the whole create cleanly.
  const ref = await deps.currentSessionResolver.resolve(scope);
  if (ref === null) {
    return err(
      operationError(
        "current_session_not_found",
        "no current Session; pass --root for a root Session or run `asem init-session`",
      ),
    );
  }
  if (ref.scope !== undefined && !sameScope(ref.scope, scope)) {
    return err(
      operationError(
        "scope_mismatch",
        "current Session belongs to a different workspace or worktree",
        { sessionId: ref.sessionId },
      ),
    );
  }
  const parent = await deps.store.getSessionById(scope, ref.sessionId);
  if (parent === null) {
    return err(
      operationError(
        "parent_session_not_found",
        "current Session is not registered in this scope",
        { parentSessionId: ref.sessionId },
      ),
    );
  }
  if (!verifyToken(ref.token, parent.tokenHash)) {
    return err(
      operationError(
        "invalid_session_token",
        "current Session token failed verification",
        { parentSessionId: ref.sessionId },
      ),
    );
  }
  return ok(parent.id);
}

/**
 * Best-effort mux cleanup after a failed create/start. Runs the `close`
 * sequence and swallows every failure: cleanup must never mask the original
 * structured error or throw (design "Create Session flow"; principle 5).
 */
async function attemptMuxCleanup(
  engine: SequenceEngine,
  closeSequence: CommandSequence,
  variables: Record<string, string>,
  cwd: string,
  deps: Pick<CreateSessionDeps, "logger">,
): Promise<void> {
  if (closeSequence.length === 0) {
    return;
  }
  try {
    const result = await engine.run(closeSequence, { cwd, variables });
    if (!result.ok) {
      deps.logger?.warn("best-effort mux cleanup failed", {
        code: result.error.code,
      });
    }
  } catch {
    deps.logger?.warn("best-effort mux cleanup threw");
  }
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
