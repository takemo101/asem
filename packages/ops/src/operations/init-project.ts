/**
 * `init` operation — initialize an asem project in a worktree.
 *
 * Creates `.asem.yaml` when missing and ensures the runtime ignore rules are
 * present in `.gitignore` so token/log state never enters Git (ADR 0001). It is
 * idempotent: an existing config is left untouched and only missing ignore rules
 * are appended.
 *
 * Both files are written at the resolved Worktree Root — the same root normal
 * Effective Scope resolution uses — not the raw shell cwd. Running `asem init`
 * from a subdirectory must protect the worktree-local runtime paths where
 * Session directories, token files, and the current-session pointer are later
 * written (implementation principle 8); otherwise token-bearing state would
 * land outside the generated ignore coverage.
 */
import {
  err,
  type FileSystem,
  type InitProjectInput,
  type InitProjectOutput,
  initProjectInputSchema,
  type Logger,
  type OperationResult,
  ok,
  operationError,
  type ScopeResolver,
} from "@asem/core";
import {
  configPathFor,
  gitignorePathFor,
  RUNTIME_GITIGNORE_RULES,
} from "../paths.ts";

/** Quote a workspace id as a YAML scalar only when it needs it. */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9._-]+$/.test(value)
    ? value
    : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Render the initial `.asem.yaml` for a workspace (design "Config design"). */
function renderConfigYaml(workspaceId: string): string {
  return [
    "workspace:",
    `  id: ${yamlScalar(workspaceId)}`,
    "",
    "mux:",
    "  default: herdr",
    "  templates: {}",
    "",
    "agent:",
    "  default: claude",
    "  templates: {}",
    "",
  ].join("\n");
}

/**
 * Append any missing runtime ignore rules to existing `.gitignore` content.
 * Existing rules are matched line-exactly so re-running `init` never duplicates
 * them. Returns `null` when nothing needs to change.
 */
function ensureGitignoreRules(existing: string | null): string | null {
  const lines = existing === null ? [] : existing.split("\n");
  const present = new Set(lines.map((line) => line.trim()));
  const missing = RUNTIME_GITIGNORE_RULES.filter((rule) => !present.has(rule));
  if (missing.length === 0) {
    return null;
  }

  const parts: string[] = [];
  if (existing !== null && existing.length > 0) {
    parts.push(existing.endsWith("\n") ? existing.slice(0, -1) : existing);
    parts.push("");
  }
  parts.push("# asem runtime state (token-bearing files; never commit)");
  parts.push(...missing);
  parts.push("");
  return parts.join("\n");
}

export async function initProject(
  deps: { fs: FileSystem; scopeResolver: ScopeResolver; logger?: Logger },
  rawInput: InitProjectInput,
): Promise<OperationResult<InitProjectOutput>> {
  const parsed = initProjectInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      operationError("invalid_input", "invalid init input", {
        issues: parsed.error.issues.map((issue) => issue.message),
      }),
    );
  }
  const { cwd, workspaceId } = parsed.data;

  // Initialize the Worktree Root, not the raw cwd, so the generated ignore
  // rules cover the worktree-local paths runtime token/log state uses.
  const worktreeRoot = await deps.scopeResolver.resolveWorktreeRoot(cwd);

  const configPath = configPathFor(worktreeRoot);
  const configExists = await deps.fs.exists(configPath);
  if (!configExists) {
    await deps.fs.writeFileAtomic(configPath, renderConfigYaml(workspaceId));
    deps.logger?.info("created .asem.yaml", { configPath });
  }

  const gitignorePath = gitignorePathFor(worktreeRoot);
  const gitignoreExists = await deps.fs.exists(gitignorePath);
  const existing = gitignoreExists
    ? await deps.fs.readFile(gitignorePath)
    : null;
  const updated = ensureGitignoreRules(existing);
  if (updated !== null) {
    await deps.fs.writeFileAtomic(gitignorePath, updated);
    deps.logger?.info("updated .gitignore runtime rules", { gitignorePath });
  }

  return ok({ configPath });
}
