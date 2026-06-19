/**
 * CLI-only Repo Alias resolution for `session create --repo <alias>` and
 * `workspace repo list`.
 *
 * A Repo Alias is purely a human convenience for choosing the `cwd` of a new
 * Session (CONTEXT.md "Repo Alias"). This module resolves an alias declared in
 * the nearest `.asem.yaml` to an absolute directory and pins that config as the
 * source, then hands the resolved path to the shared `create_session` operation
 * via `ctx.configCwd`/`input.cwd`. It introduces no Session/Message semantics of
 * its own — those still come from `@asem/ops` (architecture: "CLI-only
 * conveniences ... may resolve human-facing aliases before calling shared
 * operations"). It reads config + filesystem only, never Session state.
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

/** Resolved Repo Alias coordinates for a `create_session` call. */
export interface ResolvedRepoAlias {
  /** Resolved absolute repo path used as the effective create `cwd`. */
  cwd: string;
  /** Directory of the alias-declaring `.asem.yaml`, pinned as the config source. */
  configCwd: string;
}

/**
 * Resolve `--repo <alias>` to an absolute directory.
 *
 * Fails before any create side effects: an unknown alias is `invalid_input`
 * (the human named a repo the config does not declare, mirroring an unknown
 * `--profile`); a configured path that is missing or not a directory is
 * `invalid_config` (the declared repo path is broken).
 */
export async function resolveRepoAlias(
  deps: { configLoader: ConfigLoader; fs: FileSystem },
  cwd: string,
  alias: string,
): Promise<OperationResult<ResolvedRepoAlias>> {
  const loaded = await loadRepoConfig(deps, cwd);
  if (!loaded.ok) return loaded;
  const { config, configPath, configDir } = loaded.value;

  const entry = config.repos?.[alias];
  if (entry === undefined) {
    return err(
      operationError("invalid_input", `unknown repo alias: ${alias}`, {
        alias,
        configPath,
        available: Object.keys(config.repos ?? {}).sort(),
      }),
    );
  }

  const resolvedPath = resolve(configDir, entry.path);
  if (!(await deps.fs.isDirectory(resolvedPath))) {
    const exists = await deps.fs.exists(resolvedPath);
    return err(
      operationError(
        "invalid_config",
        exists
          ? `repo alias path is not a directory: ${resolvedPath}`
          : `repo alias path does not exist: ${resolvedPath}`,
        { alias, path: entry.path, resolvedPath, configPath },
      ),
    );
  }

  return ok({ cwd: resolvedPath, configCwd: configDir });
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
