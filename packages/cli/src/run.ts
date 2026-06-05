/**
 * CLI dispatch: parse `argv`, call the matching `@asem/ops` handler, render.
 *
 * This is the whole semantic contract of `@asem/cli`: it is a thin projection
 * over `@asem/ops`. It maps parsed flags to typed operation inputs, invokes the
 * shared handler with the injected `OpsDeps`, and renders the result or the
 * structured error. No use-case logic (scope, auth, persistence) is duplicated
 * here — every command delegates to the operation that owns it.
 */
import type { OperationError, OperationResult, OpsDeps } from "@asem/ops";
import {
  getSession,
  initProject,
  initSession,
  listMessages,
  listSessions,
} from "@asem/ops";
import type { CliCommand } from "./parse.ts";
import { parseArgs } from "./parse.ts";
import type { CliIo } from "./io.ts";
import {
  renderAttach,
  renderError,
  renderInit,
  renderInitSessionExports,
  renderMessageList,
  renderSessionDetail,
  renderSessionList,
} from "./render.ts";
import { usageFor } from "./usage.ts";

/** Inputs for one CLI invocation. `deps` is the injected operation bundle. */
export interface RunCliOptions {
  argv: readonly string[];
  cwd: string;
  deps: OpsDeps;
  io: CliIo;
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
  if (parsed.kind === "error") {
    return fail(io, parsed.error);
  }
  return dispatch(parsed.command, { cwd, deps, io });
}

type DispatchEnv = { cwd: string; deps: OpsDeps; io: CliIo };

async function dispatch(
  command: CliCommand,
  env: DispatchEnv,
): Promise<number> {
  switch (command.type) {
    case "init":
      return runInit(command, env);
    case "init-session":
      return runInitSession(command, env);
    case "session-list":
      return runSessionList(command, env);
    case "session-get":
      return runSessionGet(command, env);
    case "session-attach":
      return runSessionAttach(command, env);
    case "message-list":
      return runMessageList(command, env);
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

async function runInit(
  command: Extract<CliCommand, { type: "init" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await initProject(deps, {
    workspaceId: command.workspaceId,
    cwd,
  });
  return render(io, result, (value) => emit(io, renderInit(value.configPath)));
}

async function runInitSession(
  command: Extract<CliCommand, { type: "init-session" }>,
  { cwd, deps, io }: DispatchEnv,
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
    { cwd },
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

async function runSessionAttach(
  command: Extract<CliCommand, { type: "session-attach" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  // Attach is a thin read: it reuses get_session for the scoped domain lookup
  // and renders the attach hint it surfaces. The CLI does no domain lookup or
  // attach-command computation itself, and adds no MCP attach semantics.
  const result = await getSession(deps, { id: command.id }, { cwd });
  return render(io, result, (value) => {
    if (command.json) {
      emitJson(io, {
        session: value.session,
        attachHint: value.attachHint ?? null,
      });
      return;
    }
    emit(io, renderAttach(value.session, value.attachHint));
  });
}

async function runMessageList(
  command: Extract<CliCommand, { type: "message-list" }>,
  { cwd, deps, io }: DispatchEnv,
): Promise<number> {
  const result = await listMessages(
    deps,
    command.filter !== undefined ? { filter: command.filter } : {},
    { cwd },
  );
  return render(io, result, (value) => {
    if (command.json) emitJson(io, value.messages);
    else emit(io, renderMessageList(value.messages));
  });
}
