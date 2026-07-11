/**
 * CLI dispatch: parse `argv`, call the matching `@asem/ops` handler, render.
 *
 * This is the whole semantic contract of `@asem/cli`: it is a thin projection
 * over `@asem/ops`. It maps parsed flags to typed operation inputs, invokes the
 * shared handler with the injected `OpsDeps`, and renders the result or the
 * structured error. No use-case logic (scope, auth, persistence) is duplicated
 * here — every command delegates to the operation that owns it.
 */
import { type AttachCommand, operationError } from "@asem/core";
import {
  type InstallOptions,
  type InstallResult,
  IntegrationTargetError,
  installMcpServerForTarget,
  installSkillForTarget,
  type McpInstallResult,
} from "@asem/integrations";
import type { OperationError, OperationResult, OpsDeps } from "@asem/ops";
import {
  closeSession,
  configPathFor,
  createSession,
  deleteSession,
  doctor,
  getProfile,
  getSession,
  initProject,
  initSession,
  listMessages,
  listProfiles,
  listSessions,
  peekSession,
  reportParent,
  sendMessage,
  waitMessages,
} from "@asem/ops";
import packageJson from "../package.json" with { type: "json" };
import {
  materializeInitConfig,
  validateInitAgentName,
  validateInitMuxName,
} from "./init-config.ts";
import type { InitWizardPrompts } from "./init-wizard.ts";
import { runInitWizard } from "./init-wizard.ts";
import type { CliIo } from "./io.ts";
import type { CliCommand } from "./parse.ts";
import { parseArgs } from "./parse.ts";
import { InquirerInitWizardPrompts } from "./prompts.ts";
import {
  renderAttach,
  renderClosedSession,
  renderCreatedSession,
  renderDeletedSession,
  renderDoctor,
  renderError,
  renderInit,
  renderInitSessionExports,
  renderMessagePage,
  renderProfileGet,
  renderProfileList,
  renderRepoList,
  renderSentMessage,
  renderSessionDetail,
  renderSessionList,
  renderWaitPage,
} from "./render.ts";
import { listRepoAliases } from "./repo-alias.ts";
import { usageFor } from "./usage.ts";

/** Inputs for one CLI invocation. `deps` is the injected operation bundle. */
export type AttachRunner = (command: AttachCommand) => Promise<number>;

/**
 * Test seam for the Integration Target installers. Defaults to the production
 * `@asem/integrations` installers. These run no `@asem/ops` deps and never open
 * the durable store, keeping `mcp add` / `skills add` local-config operations.
 */
export interface IntegrationInstallers {
  installMcpServerForTarget?: (
    target: string,
    options: InstallOptions,
  ) => McpInstallResult;
  installSkillForTarget?: (
    target: string,
    options: InstallOptions,
  ) => InstallResult;
}

export interface RunCliOptions {
  argv: readonly string[];
  cwd: string;
  deps: OpsDeps;
  io: CliIo;
  /** Host-local attach executor; omitted in pure tests to render guidance only. */
  attachRunner?: AttachRunner;
  /** Test seam for interactive init; defaults to process stdin TTY state. */
  isTty?: boolean;
  /** Test seam for interactive init prompts; defaults to Inquirer prompts. */
  prompts?: InitWizardPrompts;
  /** Test seam for Integration Target installers; defaults to production. */
  integrations?: IntegrationInstallers;
  /** Home directory for global Integration Target installs (defaults to OS home). */
  home?: string;
  /**
   * Process environment forwarded to operations that safely discover the
   * current Multiplexer pane (for example `init-session` reading a complete
   * herdr pane env). Defaults to `process.env` (MIK-049).
   */
  env?: Record<string, string | undefined>;
}

/** Process-style exit codes the CLI returns (0 ok, 2 usage, 1 operation error). */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

/** Map a structured error to an exit code: bad input is usage (2), else 1. */
function exitCodeFor(error: OperationError): number {
  return error.code === "invalid_input" ? EXIT_USAGE : EXIT_ERROR;
}

function emit(io: CliIo, lines: string[]): void {
  for (const line of lines) io.out(line);
}

function fail(io: CliIo, error: OperationError): number {
  for (const line of renderError(error)) io.err(line);
  return exitCodeFor(error);
}

function emitJson(io: CliIo, value: unknown): void {
  io.out(JSON.stringify(value, null, 2));
}

/**
 * Run a single CLI command end to end. Returns the exit code; all output goes
 * through `io` so callers (binary or tests) decide where it lands.
 */
export async function runCli(opts: RunCliOptions): Promise<number> {
  const { argv, cwd, deps, io } = opts;
  const parsed = parseArgs(argv);

  if (parsed.kind === "help") {
    emit(io, usageFor(parsed.topic));
    return EXIT_OK;
  }
  if (parsed.kind === "version") {
    io.out(packageJson.version);
    return EXIT_OK;
  }
  if (parsed.kind === "error") {
    return fail(io, parsed.error);
  }
  return dispatch(parsed.command, {
    cwd,
    deps,
    io,
    isTty: opts.isTty ?? Boolean(process.stdin.isTTY),
    attachRunner: opts.attachRunner,
    prompts: opts.prompts,
    integrations: opts.integrations,
    env: opts.env ?? process.env,
    ...(opts.home !== undefined ? { home: opts.home } : {}),
  });
}

type DispatchEnv = {
  cwd: string;
  deps: OpsDeps;
  io: CliIo;
  isTty: boolean;
  attachRunner?: AttachRunner;
  prompts?: InitWizardPrompts;
  integrations?: IntegrationInstallers;
  home?: string;
  /** Process environment forwarded to env-discovering operations (MIK-049). */
  env: Record<string, string | undefined>;
};

async function dispatch(
  command: CliCommand,
  env: DispatchEnv,
): Promise<number> {
  switch (command.type) {
    case "init":
      return runInit(command, env);
    case "init-session":
      return runInitSession(command, env);
    case "doctor":
      return runDoctor(command, env);
    case "run":
      return runRun(command, env);
    case "session-create":
      return runSessionCreate(command, env);
    case "workspace-repo-list":
      return runWorkspaceRepoList(command, env);
    case "session-list":
      return runSessionList(command, env);
    case "session-get":
      return runSessionGet(command, env);
    case "session-peek":
      return runSessionPeek(command, env);
    case "session-attach":
      return runSessionAttach(command, env);
    case "session-close":
      return runSessionClose(command, env);
    case "session-delete":
      return runSessionDelete(command, env);
    case "profile-list":
      return runProfileList(command, env);
    case "profile-get":
      return runProfileGet(command, env);
    case "message-list":
      return runMessageList(command, env);
    case "message-wait":
      return runMessageWait(command, env);
    case "message-send":
      return runMessageSend(command, env);
    case "report-parent":
      return runReportParent(command, env);
    case "mcp":
      return runMcpServer(env);
    case "mcp-add":
      return runMcpAdd(command, env);
    case "skills-add":
      return runSkillsAdd(command, env);
  }
}

/** Render `result`: on error, structured error + exit code; else `onOk`. */
function render<T>(
  io: CliIo,
  result: OperationResult<T>,
  onOk: (value: T) => void,
): number {
  if (!result.ok) {
    return fail(io, result.error);
  }
  onOk(result.value);
  return EXIT_OK;
}

async function runDoctor(
  command: Extract<CliCommand, { type: "doctor" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await doctor({}, { cwd }, deps);
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value);
    else emit(io, renderDoctor(value));
  });
}

async function runInit(
  command: Extract<CliCommand, { type: "init" }>,
  { cwd, deps, io, isTty, prompts }: DispatchEnv,
): Promise<number> {
  let workspaceId = command.workspaceId;
  let agent = command.agent;
  let mux = command.mux;
  // Interactive multi-select can materialize more Templates than the defaults.
  let selectedAgents: string[] | undefined;
  let selectedMuxes: string[] | undefined;
  const worktreeRoot = await deps.scopeResolver.resolveWorktreeRoot(cwd);
  const configPath = configPathFor(worktreeRoot);
  const configExists = await deps.fs.exists(configPath);

  if (command.interactive) {
    if (!configExists && !isTty) {
      return fail(
        io,
        operationError(
          "invalid_input",
          "interactive init requires a TTY; use `asem init --workspace <id> --agent <agent> --mux <mux>` for non-interactive setup",
        ),
      );
    }
    if (!configExists) {
      if (agent !== undefined) {
        const validation = validateInitAgentName(agent);
        if (!validation.ok) return fail(io, validation.error);
      }
      if (mux !== undefined) {
        const validation = validateInitMuxName(mux);
        if (!validation.ok) return fail(io, validation.error);
      }
      const wizard = await runInitWizard({
        cwd: worktreeRoot,
        configPath,
        prompts: prompts ?? new InquirerInitWizardPrompts(),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(mux !== undefined ? { mux } : {}),
      });
      if (wizard.kind === "cancelled") {
        io.out("cancelled; no files changed");
        return EXIT_OK;
      }
      workspaceId = wizard.workspaceId;
      agent = wizard.defaultAgent;
      mux = wizard.defaultMux;
      selectedAgents = wizard.selectedAgents;
      selectedMuxes = wizard.selectedMuxes;
    }
  }

  if (workspaceId === undefined && !configExists) {
    return fail(
      io,
      operationError(
        "invalid_input",
        "workspace id is required (use `asem init --workspace <id>`)",
      ),
    );
  }

  const selectedConfig =
    !configExists &&
    workspaceId !== undefined &&
    agent !== undefined &&
    mux !== undefined
      ? materializeInitConfig({
          workspaceId,
          agent,
          mux,
          ...(selectedAgents !== undefined ? { agents: selectedAgents } : {}),
          ...(selectedMuxes !== undefined ? { muxes: selectedMuxes } : {}),
        })
      : null;
  if (selectedConfig !== null && !selectedConfig.ok) {
    return fail(io, selectedConfig.error);
  }

  const initInput = {
    cwd,
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(selectedConfig !== null
      ? { agent: selectedConfig.value.agent, mux: selectedConfig.value.mux }
      : {}),
  };
  const result = await initProject(deps, initInput);
  return render(io, result, (value) => emit(io, renderInit(value)));
}

async function runInitSession(
  command: Extract<CliCommand, { type: "init-session" }>,
  { cwd, deps, io, env }: DispatchEnv,
): Promise<number> {
  const result = await initSession(
    deps,
    {
      name: command.name,
      muxRef: command.muxRef,
      ...(command.agent !== undefined ? { agent: command.agent } : {}),
      ...(command.mux !== undefined ? { mux: command.mux } : {}),
      ...(command.parentSessionId !== undefined
        ? { parentSessionId: command.parentSessionId }
        : {}),
    },
    { cwd, env },
  );
  return render(io, result, (value) => {
    if (command.json) {
      emitJson(io, {
        sessionId: value.session.id,
        token: value.token,
        workspaceId: value.session.workspaceId,
        worktreeRoot: value.session.worktreeRoot,
      });
      return;
    }
    emit(io, renderInitSessionExports(value));
  });
}

/**
 * The CLI-local English bootstrap prompt for `asem run` root Sessions.
 *
 * It teaches the launched Agent the shipped durable Message protocol once, in
 * stable wording aligned with the shared asem Skill: durable pull-based
 * Messages, cursor-driven Inbox reads, child creation via `session create`,
 * and Reports as communication rather than completion. The optional user
 * request is appended under `## User request` only when `--prompt` was given,
 * so the bootstrap stays byte-stable for promptless launches.
 */
export function buildRunBootstrapPrompt(input: {
  agent: string;
  name: string;
  prompt?: string;
}): string {
  const lines = [
    `You are the root asem Session "${input.name}" running the "${input.agent}" Agent Template.`,
    "",
    "asem is a local Session manager: it records durable Messages and Reports",
    "between Sessions, but it never judges whether work succeeded.",
    "",
    "- Create child Sessions with `asem session create <name> --prompt '<text>'`;",
    "  children report back to you with `asem report parent --body '<text>'`.",
    "- Drain your Inbox oldest-first with `asem message list --inbox`, then keep",
    "  the final nextCursor as your Inbox position.",
    "- Wait for new Inbox Messages with `asem message wait --cursor <cursor>`; a",
    "  timeout is a successful empty page, not an error.",
    "- Message pane delivery is best-effort notification only; the durable record",
    "  is the Store, so never resend automatically.",
    "- Session status is process state, not success/failure; close child Sessions",
    "  with `asem session close <id>` when they are done.",
  ];
  if (input.prompt !== undefined) {
    lines.push("", "## User request", "", input.prompt);
  }
  return lines.join("\n");
}

/**
 * `asem run <agent>`: a thin CLI composition over the existing root
 * `create_session` use case — never a child launcher. The exact Agent Template
 * name is forwarded verbatim (no default fallback, no fuzzy match), the Session
 * name defaults to the agent name, and `root: true` is fixed so no parent
 * inference can occur. After a successful create, a TTY auto-attaches unless
 * `--no-attach`; a failed attach leaves the created Session running and exits
 * nonzero with the external attach exit code.
 */
async function runRun(
  command: Extract<CliCommand, { type: "run" }>,
  env: DispatchEnv,
): Promise<number> {
  const { cwd, deps, io, isTty, attachRunner } = env;
  const name = command.name ?? command.agent;
  const result = await createSession(
    deps,
    {
      name,
      agent: command.agent,
      prompt: buildRunBootstrapPrompt({
        agent: command.agent,
        name,
        ...(command.prompt !== undefined ? { prompt: command.prompt } : {}),
      }),
      root: true,
    },
    { cwd },
  );
  if (!result.ok) {
    return fail(io, result.error);
  }
  const session = result.value.session;
  emit(io, renderCreatedSession(session));

  if (command.noAttach || !isTty || attachRunner === undefined) {
    return EXIT_OK;
  }

  // Attach reuses get_session exactly like `asem session attach` — the CLI
  // computes no attach command itself. Any failure past this point must not
  // undo the create: the Session stays running and the exit code turns nonzero.
  const attach = await getSession(deps, { id: session.id }, { cwd });
  if (!attach.ok) {
    for (const line of renderError(attach.error)) io.err(line);
    io.err(`attach failed; Session ${session.id} is still running`);
    return EXIT_ERROR;
  }
  if (attach.value.attachCommand === undefined) {
    // No executable attach command for this mux: leave the human the manual
    // guidance instead of failing a successful launch.
    emit(io, renderAttach(attach.value.session, attach.value.attachHint));
    return EXIT_OK;
  }
  const attachCode = await attachRunner(attach.value.attachCommand);
  if (attachCode !== EXIT_OK) {
    io.err(
      `attach failed (exit ${attachCode}); Session ${session.id} is still running — reattach with \`asem session attach ${session.id}\``,
    );
  }
  return attachCode;
}

async function runSessionCreate(
  command: Extract<CliCommand, { type: "session-create" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  // Pure delegation: the CLI maps flags to the create_session input and renders
  // the result. Repo Alias resolution, parent resolution, template selection,
  // launch, cleanup, and the "never persist a failed create" ordering live in
  // the shared op so CLI and MCP agree.
  const result = await createSession(
    deps,
    {
      name: command.name,
      prompt: command.prompt,
      ...(command.agent !== undefined ? { agent: command.agent } : {}),
      ...(command.mux !== undefined ? { mux: command.mux } : {}),
      ...(command.model !== undefined ? { model: command.model } : {}),
      ...(command.profile !== undefined ? { profile: command.profile } : {}),
      ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
      ...(command.repo !== undefined ? { repo: command.repo } : {}),
      ...(command.parentSessionId !== undefined
        ? { parentSessionId: command.parentSessionId }
        : {}),
      ...(command.root !== undefined ? { root: command.root } : {}),
    },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.session);
    else emit(io, renderCreatedSession(value.session));
  });
}

/**
 * `asem workspace repo list`: render the Repo Aliases declared in the discovered
 * `.asem.yaml` and each alias's path status. This is a CLI-only convenience that
 * reads config and the filesystem; it never reads or mutates Session state.
 */
async function runWorkspaceRepoList(
  command: Extract<CliCommand, { type: "workspace-repo-list" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await listRepoAliases(deps, cwd);
  return render(io, result, (rows) => {
    if (command.json) emitJson(io, rows);
    else emit(io, renderRepoList(rows));
  });
}

async function runSessionList(
  command: Extract<CliCommand, { type: "session-list" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await listSessions(
    deps,
    command.filter !== undefined ? { filter: command.filter } : {},
    { cwd, refreshLiveness: command.refresh },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.sessions);
    else emit(io, renderSessionList(value.sessions));
  });
}

async function runSessionGet(
  command: Extract<CliCommand, { type: "session-get" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await getSession(
    deps,
    { id: command.id },
    { cwd, refreshLiveness: command.refresh },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value);
    else emit(io, renderSessionDetail(value.session, value.attachHint));
  });
}

async function runSessionPeek(
  command: Extract<CliCommand, { type: "session-peek" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await peekSession(
    deps,
    {
      id: command.id,
      ...(command.source !== undefined ? { source: command.source } : {}),
      ...(command.lines !== undefined ? { lines: command.lines } : {}),
    },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) {
      emitJson(io, value);
    } else {
      if (io.rawOut !== undefined) {
        io.rawOut(value.content);
      } else {
        emit(io, value.content.replace(/\r\n/g, "\n").split("\n"));
      }
    }
  });
}

async function runSessionAttach(
  command: Extract<CliCommand, { type: "session-attach" }>,
  { cwd, deps, io, attachRunner }: DispatchEnv,
): Promise<number> {
  // Attach is a thin host-local read/execute: it reuses get_session for the
  // scoped domain lookup and either executes or renders the attach hint it
  // surfaces. The CLI does no domain lookup or attach-command computation
  // itself, and adds no MCP attach semantics. The external attach process's
  // exit status is this command's exit status, so a failed attach cannot
  // masquerade as success.
  const result = await getSession(deps, { id: command.id }, { cwd });
  if (!result.ok) {
    return fail(io, result.error);
  }
  const value = result.value;
  if (command.json) {
    emitJson(io, {
      session: value.session,
      attachHint: value.attachHint ?? null,
      attachCommand: value.attachCommand ?? null,
    });
    return EXIT_OK;
  }
  if (value.attachCommand !== undefined && attachRunner !== undefined) {
    return attachRunner(value.attachCommand);
  }
  emit(io, renderAttach(value.session, value.attachHint));
  return EXIT_OK;
}

async function runSessionClose(
  command: Extract<CliCommand, { type: "session-close" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await closeSession(
    deps,
    { id: command.id, force: command.force },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.session);
    else emit(io, renderClosedSession(value));
  });
}

async function runSessionDelete(
  command: Extract<CliCommand, { type: "session-delete" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  // The CLI only maps the `--force`/`--yes` confirmation onto the operation
  // input; whether a delete may proceed without it is the operation's call.
  const result = await deleteSession(
    deps,
    { id: command.id, force: command.force },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value);
    else emit(io, renderDeletedSession(value));
  });
}

async function runProfileList(
  command: Extract<CliCommand, { type: "profile-list" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await listProfiles(deps, {}, { cwd });
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.profiles);
    else emit(io, renderProfileList(value.profiles));
  });
}

async function runProfileGet(
  command: Extract<CliCommand, { type: "profile-get" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await getProfile(deps, { id: command.id }, { cwd });
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.profile);
    else emit(io, renderProfileGet(value.profile));
  });
}

async function runMessageList(
  command: Extract<CliCommand, { type: "message-list" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await listMessages(
    deps,
    {
      ...(command.filter !== undefined ? { filter: command.filter } : {}),
      ...(command.cursor !== undefined ? { cursor: command.cursor } : {}),
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
    },
    { cwd },
  );
  return render(io, result, (value) => {
    // JSON is the shared page envelope — the same object shape the operation
    // and MCP return — never a bare Message array.
    if (command.json) emitJson(io, value);
    else emit(io, renderMessagePage(value));
  });
}

async function runMessageWait(
  command: Extract<CliCommand, { type: "message-wait" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  // Pure delegation to the shared bounded current-Inbox wait: current-Session
  // auth, cursor binding, the 1s poll, and the 30/60s default/max timeout all
  // live in the operation so CLI and MCP agree. A timeout is a successful
  // empty page (`timedOut: true`), so it renders through the ok path.
  const result = await waitMessages(
    deps,
    {
      cursor: command.cursor,
      ...(command.limit !== undefined ? { limit: command.limit } : {}),
      ...(command.timeoutMs !== undefined
        ? { timeoutMs: command.timeoutMs }
        : {}),
    },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value);
    else emit(io, renderWaitPage(value));
  });
}

async function runMessageSend(
  command: Extract<CliCommand, { type: "message-send" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await sendMessage(
    deps,
    { toSessionId: command.toSessionId, body: command.body },
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.message);
    else emit(io, renderSentMessage(value.message));
  });
}

async function runReportParent(
  command: Extract<CliCommand, { type: "report-parent" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await reportParent(deps, { body: command.body }, { cwd });
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.message);
    else emit(io, renderSentMessage(value.message));
  });
}

/**
 * Map an Integration Target install failure to a structured CLI error. Unknown
 * targets and unsupported scopes are user-input errors (usage exit code);
 * malformed existing config is `invalid_config` (operation error). Anything else
 * (e.g. a filesystem write error) is surfaced rather than crashing the binary.
 */
function integrationFailure(error: unknown): OperationError {
  if (error instanceof IntegrationTargetError) {
    const code =
      error.code === "invalid_config" || error.code === "io_error"
        ? "invalid_config"
        : "invalid_input";
    return operationError(
      code,
      error.message,
      error.path !== undefined ? { path: error.path } : undefined,
    );
  }
  return operationError(
    "invalid_input",
    error instanceof Error ? error.message : String(error),
  );
}

function integrationInstallOptions(
  env: DispatchEnv,
  global: boolean,
): InstallOptions {
  return {
    cwd: env.cwd,
    global,
    ...(env.home !== undefined ? { home: env.home } : {}),
  };
}

/**
 * `asem mcp` (no subcommand) starts the stdio server, which the binary
 * composition root owns (it needs a real terminal/process host). Reaching this
 * dispatch branch means the server path was not intercepted, so surface a clear
 * error instead of silently doing nothing.
 */
function runMcpServer({ io }: DispatchEnv): number {
  return fail(
    io,
    operationError(
      "invalid_input",
      "`asem mcp` starts the MCP server and is launched by the asem binary; use `asem mcp add --for <target>` to register asem with an Integration Target",
    ),
  );
}

/** `asem mcp add --for <target>`: register the fixed asem MCP server entry. */
function runMcpAdd(
  command: Extract<CliCommand, { type: "mcp-add" }>,
  env: DispatchEnv,
): number {
  const install =
    env.integrations?.installMcpServerForTarget ?? installMcpServerForTarget;
  try {
    const result = install(
      command.target,
      integrationInstallOptions(env, command.global),
    );
    emit(env.io, [
      `Registered MCP server '${result.serverName}' for ${result.target} (${result.scope}): ${result.path}`,
    ]);
    return EXIT_OK;
  } catch (error) {
    return fail(env.io, integrationFailure(error));
  }
}

/** `asem skills add --for <target>`: install the shared asem Skill document. */
function runSkillsAdd(
  command: Extract<CliCommand, { type: "skills-add" }>,
  env: DispatchEnv,
): number {
  const install =
    env.integrations?.installSkillForTarget ?? installSkillForTarget;
  try {
    const result = install(
      command.target,
      integrationInstallOptions(env, command.global),
    );
    emit(env.io, [
      `Installed asem Skill for ${result.target} (${result.scope}): ${result.path}`,
    ]);
    return EXIT_OK;
  } catch (error) {
    return fail(env.io, integrationFailure(error));
  }
}
