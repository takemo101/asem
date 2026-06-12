/**
 * `asem tui` surface: parse the `--scope` flag and launch the cockpit.
 *
 * Like `asem mcp`, the TUI is intercepted in the composition root rather than the
 * pure dispatch table, because it needs a real terminal host. This module keeps
 * the testable part — scope-flag parsing — pure and separate from the host
 * wiring. The cockpit's behavior lives in `@asem/tui`; the CLI only resolves the
 * scope, builds the ANSI host, and renders any structured error.
 */
import {
  type OperationError,
  type OperationResult,
  operationError,
} from "@asem/core";
import type { OpsDeps } from "@asem/ops";
import {
  AnsiCockpitHost,
  type CockpitHost,
  type CockpitScopeMode,
  runCockpit,
} from "@asem/tui";
import type { CliIo } from "./io.ts";
import { renderError } from "./render.ts";

/**
 * Parse `asem tui` flags into a scope mode. The cockpit defaults to the
 * workspace-wide view (ADR 0004); `--scope worktree` keeps the current-worktree
 * focus. Only the human TUI broadens scope — normal CLI/MCP operations remain
 * worktree-isolated.
 */
export function parseTuiScope(
  args: readonly string[],
): OperationResult<CockpitScopeMode> {
  let scope: CockpitScopeMode = "workspace";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      break;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (!arg.startsWith("--") || name !== "scope") {
      return {
        ok: false,
        error: operationError("invalid_input", `unknown option ${arg}`, {
          expected: ["--scope worktree", "--scope workspace"],
        }),
      };
    }
    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      value = args[i + 1];
      i += 1;
    }
    if (value !== "worktree" && value !== "workspace") {
      return {
        ok: false,
        error: operationError(
          "invalid_input",
          "scope must be `worktree` or `workspace`",
          { value: value ?? null },
        ),
      };
    }
    scope = value;
  }
  return { ok: true, value: scope };
}

/**
 * Build the cockpit's terminal host. The OpenTUI/React renderer is the normal
 * `asem tui` host (design "Renderer"); the built-in ANSI host remains the
 * fallback for non-TTY stdout, `ASEM_TUI_RENDERER=ansi`, or an OpenTUI load
 * failure. The OpenTUI module is loaded lazily through the `@asem/tui/opentui`
 * subpath so non-TUI surfaces (MCP, plain CLI) never pull it in.
 */
async function buildHost(): Promise<CockpitHost> {
  const wantOpenTui =
    process.stdout.isTTY === true && process.env.ASEM_TUI_RENDERER !== "ansi";
  if (!wantOpenTui) {
    return new AnsiCockpitHost();
  }
  try {
    const opentui = await import("@asem/tui/opentui");
    return new opentui.OpenTuiCockpitHost();
  } catch {
    return new AnsiCockpitHost();
  }
}

/**
 * Run `asem tui`: parse the scope, open the cockpit against a terminal host
 * (OpenTUI when available, ANSI fallback), and render any structured error to
 * stderr. Returns a process exit code (0 ok, 2 bad flags, 1 operation error).
 */
export async function runTuiCommand(opts: {
  args: readonly string[];
  cwd: string;
  deps: OpsDeps;
  io: CliIo;
}): Promise<number> {
  const scope = parseTuiScope(opts.args);
  if (!scope.ok) {
    return fail(opts.io, scope.error, 2);
  }
  const host = await buildHost();
  const result = await runCockpit(opts.deps, host, {
    cwd: opts.cwd,
    scopeMode: scope.value,
  });
  if (!result.ok) {
    return fail(opts.io, result.error, 1);
  }
  return 0;
}

function fail(io: CliIo, error: OperationError, code: number): number {
  for (const line of renderError(error)) io.err(line);
  return code;
}
