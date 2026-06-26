/**
 * `create_session` operation — launch a new agent Session end-to-end.
 *
 * This is one of asem's most important correctness boundaries (implementation
 * principle 5: never persist failed create rows). The flow is strictly ordered:
 *
 *   1. resolve config / scope from the effective create cwd (`input.cwd ?? ctx.cwd`);
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
import { dirname, relative, resolve } from "node:path";
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
  type HostPaths,
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
  type ResolvedProfile,
  renderProfilePrompt,
  resolveProfile,
} from "@asem/profiles";
import {
  type AgentTemplate,
  type CommandSequence,
  createRedactor,
  interpolateValues,
  MissingVariableError,
  type MuxTemplate,
  renderAgentCommand,
  SequenceEngine,
} from "@asem/runtime";
import {
  authenticateCurrentSession,
  resolveContext,
  sameScope,
} from "../context.ts";
import type { OpContext } from "../deps.ts";
import { joinPath, sessionDirFor, TOKEN_FILE_MODE } from "../paths.ts";
import { profileDirsFor } from "../profiles.ts";
import { resolveAgentTemplate, resolveMuxTemplate } from "../templates.ts";

type CreateSessionDeps = {
  store: Store;
  fs: FileSystem;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  templateRegistryFactory: TemplateRegistryFactory;
  templateRunner: TemplateRunner;
  hostPaths: HostPaths;
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

function isInsideDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

async function resolveRepoCreateCwd(
  deps: Pick<CreateSessionDeps, "configLoader" | "fs">,
  configCwd: string,
  alias: string,
): Promise<OperationResult<{ cwd: string; configCwd: string }>> {
  const discovery = await deps.configLoader.load(configCwd);
  if (discovery.kind === "not_found") {
    return err(
      operationError(
        "config_not_found",
        "no .asem.yaml found; run `asem init` to create one",
        { cwd: configCwd },
      ),
    );
  }
  if (discovery.kind === "invalid") {
    return err(
      operationError("invalid_config", "`.asem.yaml` could not be parsed", {
        configPath: discovery.configPath,
        issues: discovery.issues,
      }),
    );
  }

  const configDir = dirname(discovery.configPath);
  const entry = discovery.config.repos?.[alias];
  if (entry === undefined) {
    return err(
      operationError("invalid_input", `unknown repo alias: ${alias}`, {
        alias,
        configPath: discovery.configPath,
        available: Object.keys(discovery.config.repos ?? {}).sort(),
      }),
    );
  }

  const resolvedPath = resolve(configDir, entry.path);
  if (!isInsideDir(configDir, resolvedPath)) {
    return err(
      operationError(
        "invalid_config",
        `repo alias path must be under the Workspace root: ${resolvedPath}`,
        {
          alias,
          path: entry.path,
          resolvedPath,
          configPath: discovery.configPath,
        },
      ),
    );
  }
  if (!(await deps.fs.isDirectory(resolvedPath))) {
    const exists = await deps.fs.exists(resolvedPath);
    return err(
      operationError(
        "invalid_config",
        exists
          ? `repo alias path is not a directory: ${resolvedPath}`
          : `repo alias path does not exist: ${resolvedPath}`,
        {
          alias,
          path: entry.path,
          resolvedPath,
          configPath: discovery.configPath,
        },
      ),
    );
  }

  return ok({ cwd: resolvedPath, configCwd: configDir });
}

/**
 * Render the Session launch script. Env injection is centralized here so the
 * raw token never leaks through command-line args, pane labels, or shell
 * history — it lives only in this mode-0600 file (design "Launch script
 * standard"). `AS_PROJECT_ROOT` is an optional alias for the worktree root.
 *
 * Agent Template `before_agent` / `after_agent` hooks (MIK-034) are literal
 * shell command lines woven around the Agent process inside this script — never
 * `{{…}}`-interpolated; they read the exported launch env instead:
 *
 * - `before_agent` runs under the script's `set -euo pipefail`, so the first
 *   failing hook aborts before the Agent command starts (strict).
 * - `after_agent` runs after the Agent command exits with `set -e` disabled, so
 *   every after hook is attempted even if an earlier one fails (best-effort),
 *   with the Agent's exit code captured into `AS_AGENT_EXIT_CODE` and preserved
 *   as the script's final exit code. It is not guaranteed under a mux forced
 *   kill/close that terminates the pane before the Agent returns control.
 */
function buildLaunchScript(params: {
  env: Record<string, string>;
  cwd: string;
  agentCommand: string;
  beforeAgent: string[];
  afterAgent: string[];
}): string {
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""];
  for (const [key, value] of Object.entries(params.env)) {
    lines.push(`export ${key}=${shellEscape(value)}`);
  }
  lines.push("");
  lines.push(`cd ${shellEscape(params.cwd)}`);
  lines.push("");

  // before_agent (strict): runs under set -e, so a failure aborts the script
  // before the Agent command starts. Lines are inserted verbatim.
  for (const line of params.beforeAgent) {
    lines.push(line);
  }
  if (params.beforeAgent.length > 0) {
    lines.push("");
  }

  if (params.afterAgent.length > 0) {
    // Capture the Agent exit code and expose it to after hooks, run every after
    // hook best-effort, then exit with the preserved code. Disable errexit
    // before running the Agent command so a non-zero Agent exit can be captured,
    // but keep nounset active for the Agent command itself; an unset variable in
    // the launch command is a pre-start defect, not an Agent exit. Disable
    // nounset only for the after-hook region so an after hook referencing an
    // unset variable cannot abort later after hooks. pipefail is harmless with
    // errexit off.
    lines.push("set +e");
    lines.push(params.agentCommand);
    lines.push("AS_AGENT_EXIT_CODE=$?");
    lines.push("export AS_AGENT_EXIT_CODE");
    lines.push("set +u");
    for (const line of params.afterAgent) {
      lines.push(line);
    }
    lines.push('exit "$AS_AGENT_EXIT_CODE"');
  } else {
    // No after hooks: the Agent command is last, so its exit code is naturally
    // the script's exit code under set -e.
    lines.push(params.agentCommand);
  }
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

  // Resolve config and location from the requested create target. A create can
  // target a sibling Worktree Root via `input.cwd` or the shared `repo` alias
  // shortcut. Repo Alias resolution lives in ops so CLI and MCP share the same
  // behavior: the alias pins config to the declaring Workspace root and maps to
  // an effective create cwd under that root.
  let cwd = input.cwd ?? ctx.cwd;
  let configCwd = ctx.configCwd ?? cwd;
  if (input.repo !== undefined) {
    const repoResult = await resolveRepoCreateCwd(
      deps,
      ctx.configCwd ?? ctx.cwd,
      input.repo,
    );
    if (!repoResult.ok) {
      return repoResult;
    }
    cwd = repoResult.value.cwd;
    configCwd = repoResult.value.configCwd;
  }
  const contextResult = await resolveContext(deps, configCwd, cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, scope } = contextResult.value;

  // MCP/agent-origin create calls must prove a current Session token even when
  // the requested parent mode is explicit `--parent` or `--root`. CLI human
  // local-trust calls leave origin unset and keep the documented local behavior.
  if (ctx.origin === "agent") {
    const auth = await authenticateCurrentSession(deps, scope);
    if (!auth.ok) {
      return auth;
    }
  }

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

  // --- Resolve the requested Agent Profile (fail fast, before side effects) ---
  // Profile discovery reads files but mutates nothing; an unknown id is
  // `invalid_input` and a malformed/duplicate profile file is `invalid_config`,
  // both surfaced here before any filesystem/mux/store side effect (MIK-041).
  let selectedProfile: ResolvedProfile | null = null;
  if (input.profile !== undefined) {
    const dirs = profileDirsFor(scope.worktreeRoot, deps.hostPaths.homeDir());
    const profileResult = await resolveProfile(deps.fs, dirs, input.profile);
    if (!profileResult.ok) {
      return err(profileResult.error);
    }
    selectedProfile = profileResult.value;
  }

  // --- Resolve templates (fail fast, before any filesystem side effects) ---
  // Layer this config's project-local templates over the builtins, so a
  // `.asem.yaml` mux/agent definition resolves through the same typed path.
  const templateRegistry = deps.templateRegistryFactory.forConfig(config);
  const mux = input.mux ?? config.mux.default;
  // Agent/model precedence: explicit input > selected profile default > config
  // default (design "Create Session resolution").
  const agent = input.agent ?? selectedProfile?.agent ?? config.agent.default;
  const resolvedModel = resolveModel(input, selectedProfile);

  // A malformed project-local template is a recoverable config defect, surfaced
  // as a structured `invalid_template` error before any side effects rather than
  // a thrown schema exception (MIK-026). A missing name stays the existing
  // `*_template_not_found`.
  const muxResult = resolveMuxTemplate(templateRegistry, mux);
  if (!muxResult.ok) {
    return err(muxResult.error);
  }
  if (muxResult.value === undefined) {
    return err(
      operationError("mux_template_not_found", "mux template not found", {
        mux,
      }),
    );
  }
  const muxTemplate: MuxTemplate = muxResult.value;

  const agentResult = resolveAgentTemplate(templateRegistry, agent);
  if (!agentResult.ok) {
    return err(agentResult.error);
  }
  if (agentResult.value === undefined) {
    return err(
      operationError("agent_template_not_found", "agent template not found", {
        agent,
      }),
    );
  }
  const agentTemplate: AgentTemplate = agentResult.value;

  // Model support is a Template capability: a Template declares it by carrying a
  // `model_flag` (paired with `{{model_shell}}`, enforced by the runtime schema).
  // Requesting a model for a Template that cannot use it must fail before any
  // filesystem/mux/store side effects rather than silently launching without it
  // (MIK-040). asem does not validate the model name itself.
  if (resolvedModel !== undefined && agentTemplate.model_flag === undefined) {
    return err(
      operationError(
        "invalid_input",
        "agent template does not support --model",
        { agent, model: resolvedModel },
      ),
    );
  }

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
    cwd_kdl: escapeKdlString(cwd),
    name: input.name,
    agent,
    mux,
    model: resolvedModel ?? "",
    session_dir: sessionDir,
    prompt_path: promptPath,
    launch_script: launchScriptPath,
    launch_script_kdl: escapeKdlString(launchScriptPath),
    launch_cmd: `bash ${shellEscape(launchScriptPath)}`,
  };

  // Declared template refs interpolate from the base vars alone, so a ref
  // referencing an unknown variable is a template defect caught here — before
  // any filesystem or mux side effects.
  let declaredRefs: Record<string, string>;
  try {
    declaredRefs = interpolateValues(muxTemplate.refs, baseVars);
  } catch (error) {
    if (error instanceof MissingVariableError) {
      return err(
        operationError(
          "invalid_template",
          `mux template ref references unknown variable {{${error.variable}}}`,
          { kind: "mux", name: mux, variable: error.variable },
        ),
      );
    }
    throw error;
  }

  // The effective prompt is the user prompt shaped by the selected profile
  // (instructions first, original prompt preserved under `# User Prompt`). With
  // no profile it is the user prompt unchanged. It is what `prompt.md` stores and
  // what `paste_prompt` delivery sends, so all delivery modes agree (MIK-041).
  const effectivePrompt =
    selectedProfile === null
      ? input.prompt
      : renderProfilePrompt(selectedProfile, input.prompt);
  // prompt.md and `paste_prompt` delivery must use identical bytes (design: the
  // same effective prompt is used for every delivery mode). Derive one canonical
  // `promptContents` — the effective prompt with the file's trailing-newline
  // policy applied once — and use it for both the file write and the paste
  // `send` below, so neither path can drift from the other.
  const promptContents = ensureTrailingNewline(effectivePrompt);

  // Step 4 & 5: create the Session dir and always write prompt.md.
  await deps.fs.mkdirp(sessionDir);
  await deps.fs.writeFileAtomic(promptPath, promptContents);

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
  // The Session's mux ref is the declared refs plus the create captures; a
  // capture wins on a name conflict because it carries the live coordinate.
  const muxRef = { ...declaredRefs, ...createResult.value.captures };
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
      AS_SESSION_DIR: sessionDir,
      AS_PROMPT_PATH: promptPath,
      AS_SESSION_NAME: input.name,
      AS_AGENT: agent,
      AS_MUX: mux,
      AS_MODEL: resolvedModel ?? "",
      // Empty when no profile was selected (design "Create Session resolution").
      AS_PROFILE: selectedProfile?.id ?? "",
      AS_PROFILE_SOURCE: selectedProfile?.source ?? "",
    },
    cwd,
    agentCommand: renderAgentCommand(agentTemplate, {
      promptPath,
      model: resolvedModel ?? null,
    }),
    beforeAgent: agentTemplate.before_agent,
    afterAgent: agentTemplate.after_agent,
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

  // Step 8b: paste delivery. For `paste_prompt` agents the launch command starts
  // the Agent bare, so the prompt is delivered here — after the Agent starts and
  // before the Session row exists — by running the agent template's
  // `before_paste` setup/wait and then the mux `send` sequence with the prompt
  // as the message. A failure cleans up the pane and leaves no row, like every
  // other pre-insert step (principle 5). Non-paste agents skip this entirely.
  if (agentTemplate.paste_prompt) {
    const beforePasteResult = await engine.run(agentTemplate.before_paste, {
      cwd,
      variables: runVars,
    });
    if (!beforePasteResult.ok) {
      await attemptMuxCleanup(engine, muxTemplate.close, runVars, cwd, deps);
      deps.logger?.error("agent before_paste failed", {
        sessionId: id,
        code: beforePasteResult.error.code,
      });
      return err(withLogPath(beforePasteResult.error, sessionDir));
    }
    const sendResult = await engine.run(muxTemplate.send, {
      cwd,
      variables: { ...runVars, message: promptContents },
    });
    if (!sendResult.ok) {
      await attemptMuxCleanup(engine, muxTemplate.close, runVars, cwd, deps);
      deps.logger?.error("paste prompt send failed", {
        sessionId: id,
        code: sendResult.error.code,
      });
      return err(withLogPath(sendResult.error, sessionDir));
    }
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
    model: resolvedModel ?? null,
    profile: selectedProfile?.id ?? null,
    profileSource: selectedProfile?.source ?? null,
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

/**
 * Resolve the launch model per the design precedence:
 *
 *   explicit `model` input > selected profile `model` > none
 *
 * with one suppression rule: if an explicit `agent` is given that differs from
 * the selected profile's default `agent`, the profile's default `model` is
 * dropped. This avoids applying a Claude-oriented profile model to a different
 * Agent such as `pi` or `agy`. A profile with no default `agent` is treated as
 * "differs" whenever an explicit agent is supplied, so its model never leaks onto
 * an unrelated Agent. The profile *instructions* still apply regardless. Whether
 * the final Agent Template actually supports a model is validated separately.
 */
function resolveModel(
  input: CreateSessionInput,
  profile: ResolvedProfile | null,
): string | undefined {
  if (input.model !== undefined) {
    return input.model;
  }
  if (profile?.model == null) {
    return undefined;
  }
  if (input.agent !== undefined && input.agent !== profile.agent) {
    return undefined;
  }
  return profile.model;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Escape a value for a quoted KDL string literal. */
function escapeKdlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}
