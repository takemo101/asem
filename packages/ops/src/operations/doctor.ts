import {
  type DoctorExecutableCheck,
  type DoctorInput,
  doctorInputSchema,
  type DoctorOutput,
  type OperationResult,
  operationError,
} from "@asem/core";
import type { OpContext, OpsDeps } from "../deps.ts";

const BUILTIN_MUX_EXECUTABLES = [
  ["herdr", "herdr"],
  ["rmux", "rmux"],
  ["tmux", "tmux"],
  ["zellij", "zellij"],
] as const;

const BUILTIN_AGENT_EXECUTABLES = [
  ["agy", "agy"],
  ["claude", "claude"],
  ["codex", "codex"],
  ["gemini", "gemini"],
  ["opencode", "opencode"],
  ["pi", "pi"],
] as const;

export async function doctor(
  input: DoctorInput,
  ctx: OpContext,
  deps: Pick<OpsDeps, "configLoader" | "executableResolver">,
): Promise<OperationResult<DoctorOutput>> {
  const parsed = doctorInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: operationError("invalid_input", "invalid doctor input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    };
  }

  const discovered = await deps.configLoader.load(ctx.cwd);
  const defaultMux =
    discovered.kind === "found" ? discovered.config.mux.default : null;
  const defaultAgent =
    discovered.kind === "found" ? discovered.config.agent.default : null;

  const config: DoctorOutput["config"] =
    discovered.kind === "found"
      ? {
          kind: "found",
          configPath: discovered.configPath,
          workspaceId: discovered.config.workspace.id,
          defaultAgent: discovered.config.agent.default,
          defaultMux: discovered.config.mux.default,
        }
      : discovered.kind === "invalid"
        ? {
            kind: "invalid",
            configPath: discovered.configPath,
            issues: discovered.issues,
          }
        : { kind: "not_found" };

  return {
    ok: true,
    value: {
      config,
      multiplexers: await checks(
        "mux",
        BUILTIN_MUX_EXECUTABLES,
        defaultMux,
        deps,
      ),
      agents: await checks(
        "agent",
        BUILTIN_AGENT_EXECUTABLES,
        defaultAgent,
        deps,
      ),
    },
  };
}

async function checks(
  kind: "agent" | "mux",
  entries: readonly (readonly [template: string, executable: string])[],
  defaultTemplate: string | null,
  deps: Pick<OpsDeps, "executableResolver">,
): Promise<DoctorExecutableCheck[]> {
  const out: DoctorExecutableCheck[] = [];
  for (const [template, executable] of entries) {
    const path = await deps.executableResolver.which(executable);
    out.push({
      kind,
      template,
      executable,
      status: path === null ? "missing" : "ok",
      path,
      isDefault: defaultTemplate === template,
    });
  }
  return out;
}
