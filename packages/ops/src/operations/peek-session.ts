import {
  type ConfigLoader,
  type CurrentSessionResolver,
  err,
  type Logger,
  type OperationResult,
  ok,
  operationError,
  type PeekSessionInput,
  type PeekSessionOutput,
  peekSessionInputSchema,
  type Redactor,
  type ScopeResolver,
  type Session,
  type Store,
  type TemplateRegistryFactory,
  type TemplateRunner,
} from "@asem/core";
import { type MuxTemplate, SequenceEngine } from "@asem/runtime";
import { authenticateAgentOrigin, resolveContext } from "../context.ts";
import type { OpContext } from "../deps.ts";
import { muxRefVars } from "../mux-vars.ts";
import { resolveMuxTemplate } from "../templates.ts";

type PeekSessionDeps = {
  store: Store;
  configLoader: ConfigLoader;
  scopeResolver: ScopeResolver;
  currentSessionResolver: CurrentSessionResolver;
  templateRegistryFactory: TemplateRegistryFactory;
  templateRunner: TemplateRunner;
  logger?: Logger;
  redactor?: Redactor;
};

export async function peekSession(
  deps: PeekSessionDeps,
  rawInput: PeekSessionInput,
  ctx: OpContext,
): Promise<OperationResult<PeekSessionOutput>> {
  const parsed = peekSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid peek-session input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }

  const contextResult = await resolveContext(deps, ctx.cwd);
  if (!contextResult.ok) {
    return contextResult;
  }
  const { config, scope } = contextResult.value;

  const auth = await authenticateAgentOrigin(deps, scope, ctx);
  if (!auth.ok) {
    return auth;
  }

  const session = await deps.store.getSessionById(scope, parsed.data.id);
  if (session === null) {
    return err(
      operationError("session_not_found", "Session not found in this scope", {
        id: parsed.data.id,
      }),
    );
  }

  const registry = deps.templateRegistryFactory.forConfig(config);
  const muxResult = resolveMuxTemplate(registry, session.mux);
  if (!muxResult.ok) {
    return err(muxResult.error);
  }
  if (muxResult.value === undefined) {
    return err(
      operationError("mux_template_not_found", "mux template not found", {
        mux: session.mux,
      }),
    );
  }

  const template = muxResult.value;
  if (!hasForegroundRun(template)) {
    return err(
      operationError(
        "mux_peek_unsupported",
        "mux template does not support peek",
        {
          mux: session.mux,
        },
      ),
    );
  }

  const engine = new SequenceEngine({
    runner: deps.templateRunner,
    logger: deps.logger,
    redactor: deps.redactor,
  });
  const result = await engine.runForFinalStdout(template.peek, {
    cwd: session.cwd,
    variables: peekVars(session, parsed.data.source, parsed.data.lines),
  });
  if (!result.ok) {
    if (result.error.code === "timeout") {
      return result;
    }
    if (result.error.details?.exitCode === 42) {
      return err(
        operationError(
          "unsupported_source",
          "mux does not support requested peek source",
          {
            sessionId: session.id,
            mux: session.mux,
            source: parsed.data.source,
          },
        ),
      );
    }
    return err(
      operationError("peek_failed", "failed to read Session pane output", {
        sessionId: session.id,
        mux: session.mux,
        cause: result.error.code,
      }),
    );
  }

  return ok({
    session,
    source: parsed.data.source,
    lines: parsed.data.lines,
    content: result.value.stdout,
  });
}

function hasForegroundRun(template: MuxTemplate): boolean {
  return template.peek.some(
    (step) => step.type === "run" && step.background !== true,
  );
}

function peekVars(
  session: Session,
  source: string,
  lines: number,
): Record<string, string> {
  return {
    session_id: session.id,
    name: session.name,
    cwd: session.cwd,
    worktree_root: session.worktreeRoot,
    workspace_id: session.workspaceId,
    agent: session.agent,
    mux: session.mux,
    peek_source: source,
    peek_lines: String(lines),
    ...muxRefVars(session.muxRef),
  };
}
