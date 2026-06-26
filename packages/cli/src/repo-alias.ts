/**
 * CLI-only Repo Alias listing for `workspace repo list`.
 *
 * Repo Alias resolution for `session create --repo <alias>` lives in `@asem/ops`
 * so CLI and MCP share the same validation and Workspace semantics. This module
 * only renders configured aliases and path status for the human CLI.
 */
import { dirname, resolve } from "node:path";
import {
  type Config,
  type ConfigLoader,
  err,
  type FileSystem,
  type OperationResult,
  ok,
  operationError,
} from "@asem/core";

/** The alias-declaring config plus the directory it lives in. */
interface RepoConfig {
  config: Config;
  configPath: string;
  configDir: string;
}

/**
 * Discover and parse the nearest `.asem.yaml` from `cwd`, mapping discovery
 * failures to the same structured errors the operations surface so the CLI never
 * inspects the loader's internals.
 */
async function loadRepoConfig(
  deps: { configLoader: ConfigLoader },
  cwd: string,
): Promise<OperationResult<RepoConfig>> {
  const discovery = await deps.configLoader.load(cwd);
  if (discovery.kind === "not_found") {
    return err(
      operationError(
        "config_not_found",
        "no .asem.yaml found; run `asem init` to create one",
        { cwd },
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
  return ok({
    config: discovery.config,
    configPath: discovery.configPath,
    configDir: dirname(discovery.configPath),
  });
}

/** One row of `workspace repo list`. */
export interface RepoAliasStatus {
  alias: string;
  /** Path exactly as written in `.asem.yaml`. */
  configuredPath: string;
  /** `configuredPath` resolved against the config directory. */
  resolvedPath: string;
  /** Whether `resolvedPath` currently exists. */
  exists: boolean;
  /** Whether `resolvedPath` is currently a directory. */
  directory: boolean;
}

/**
 * List the Repo Aliases declared in the discovered config, each with its
 * configured path, resolved path, and current path status. Reads config and the
 * filesystem only — it never reads or mutates Session state (Repo Alias design).
 */
export async function listRepoAliases(
  deps: { configLoader: ConfigLoader; fs: FileSystem },
  cwd: string,
): Promise<OperationResult<RepoAliasStatus[]>> {
  const loaded = await loadRepoConfig(deps, cwd);
  if (!loaded.ok) return loaded;
  const { config, configDir } = loaded.value;

  const repos = config.repos ?? {};
  const rows: RepoAliasStatus[] = [];
  const aliases = Object.entries(repos).sort(([a], [b]) => a.localeCompare(b));
  for (const [alias, entry] of aliases) {
    const configuredPath = entry.path;
    const resolvedPath = resolve(configDir, configuredPath);
    const directory = await deps.fs.isDirectory(resolvedPath);
    const exists = directory ? true : await deps.fs.exists(resolvedPath);
    rows.push({ alias, configuredPath, resolvedPath, exists, directory });
  }
  return ok(rows);
}
