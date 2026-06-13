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
  type AgentConfig,
  err,
  type FileSystem,
  type InitProjectInput,
  type InitProjectOutput,
  initProjectInputSchema,
  type Logger,
  type MuxConfig,
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

/** Render one YAML scalar for the small config/template shapes init owns. */
function yamlValue(value: unknown): string {
  if (typeof value === "string") return yamlScalar(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return yamlScalar(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderYamlCollection(value: unknown, indent: number): string[] {
  if (Array.isArray(value)) return renderYamlArray(value, indent);
  if (isRecord(value)) return renderYamlObject(value, indent);
  return [`${" ".repeat(indent)}${yamlValue(value)}`];
}

function renderYamlObject(
  object: Record<string, unknown>,
  indent: number,
): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(object)) {
    if (Array.isArray(value)) {
      const childLines = renderYamlArray(value, indent + 2);
      if (childLines.length > 0) {
        lines.push(`${pad}${key}:`);
        lines.push(...childLines);
      }
      continue;
    }
    if (isRecord(value)) {
      const childLines = renderYamlObject(value, indent + 2);
      if (childLines.length > 0) {
        lines.push(`${pad}${key}:`);
        lines.push(...childLines);
      }
      continue;
    }
    lines.push(`${pad}${key}: ${yamlValue(value)}`);
  }
  return lines;
}

function pushArrayChild(
  lines: string[],
  keyPrefix: string,
  value: unknown,
  childIndent: number,
): void {
  if (Array.isArray(value)) {
    const childLines = renderYamlArray(value, childIndent);
    if (childLines.length > 0) {
      lines.push(`${keyPrefix}:`);
      lines.push(...childLines);
    }
    return;
  }
  if (isRecord(value)) {
    const childLines = renderYamlObject(value, childIndent);
    if (childLines.length > 0) {
      lines.push(`${keyPrefix}:`);
      lines.push(...childLines);
    }
    return;
  }
  lines.push(`${keyPrefix}: ${yamlValue(value)}`);
}

function renderYamlArray(values: unknown[], indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      const childLines = renderYamlArray(value, indent + 2);
      if (childLines.length > 0) {
        lines.push(`${pad}-`);
        lines.push(...childLines);
      }
      continue;
    }
    if (isRecord(value)) {
      const entries = Object.entries(value);
      const firstRenderable = entries.find(([, child]) =>
        Array.isArray(child) || isRecord(child)
          ? renderYamlCollection(child, indent + 2).length > 0
          : true,
      );
      if (firstRenderable === undefined) {
        continue;
      }
      const [firstKey, firstValue] = firstRenderable;
      pushArrayChild(lines, `${pad}- ${firstKey}`, firstValue, indent + 2);
      for (const [key, child] of entries.slice(
        entries.indexOf(firstRenderable) + 1,
      )) {
        pushArrayChild(lines, `${pad}  ${key}`, child, indent + 4);
      }
      continue;
    }
    lines.push(`${pad}- ${yamlValue(value)}`);
  }
  return lines;
}

function configSectionWithOptionalTemplates(
  section: MuxConfig | AgentConfig,
): Record<string, unknown> {
  const result: Record<string, unknown> = { default: section.default };
  if (Object.keys(section.templates).length > 0) {
    result.templates = section.templates;
  }
  return result;
}

/** Render the initial `.asem.yaml` for a workspace (design "Config design"). */
function renderConfigYaml(
  workspaceId: string,
  mux?: MuxConfig,
  agent?: AgentConfig,
): string {
  const config = {
    workspace: { id: workspaceId },
    mux: configSectionWithOptionalTemplates(
      mux ?? { default: "herdr", templates: {} },
    ),
    agent: configSectionWithOptionalTemplates(
      agent ?? { default: "claude", templates: {} },
    ),
  };
  return `${renderYamlObject(config, 0).join("\n")}\n`;
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
  const { cwd, workspaceId, mux, agent } = parsed.data;

  // Initialize the Worktree Root, not the raw cwd, so the generated ignore
  // rules cover the worktree-local paths runtime token/log state uses.
  const worktreeRoot = await deps.scopeResolver.resolveWorktreeRoot(cwd);

  const configPath = configPathFor(worktreeRoot);
  const configExists = await deps.fs.exists(configPath);
  let configCreated = false;
  if (!configExists) {
    if (workspaceId === undefined) {
      return err(
        operationError(
          "invalid_input",
          "workspace id is required (use `asem init --workspace <id>`)",
        ),
      );
    }
    await deps.fs.writeFileAtomic(
      configPath,
      renderConfigYaml(workspaceId, mux, agent),
    );
    configCreated = true;
    deps.logger?.info("created .asem.yaml", { configPath });
  }

  const gitignorePath = gitignorePathFor(worktreeRoot);
  const gitignoreExists = await deps.fs.exists(gitignorePath);
  const existing = gitignoreExists
    ? await deps.fs.readFile(gitignorePath)
    : null;
  const updated = ensureGitignoreRules(existing);
  const gitignoreUpdated = updated !== null;
  if (gitignoreUpdated) {
    await deps.fs.writeFileAtomic(gitignorePath, updated);
    deps.logger?.info("updated .gitignore runtime rules", { gitignorePath });
  }

  return ok({ configPath, configCreated, gitignoreUpdated });
}
