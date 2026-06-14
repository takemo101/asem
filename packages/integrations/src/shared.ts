/**
 * Shared helpers for Integration Target installers.
 *
 * An Integration Target is an external AI client whose local config can be
 * updated so it knows how to use asem. These helpers own scope selection, path
 * resolution from injected `cwd`/`home` roots, JSON read/parse, atomic writes,
 * and the structured errors the CLI renders. Target adapters encode only the
 * per-target path and entry-schema differences on top of these primitives.
 *
 * This module deliberately depends on nothing in the asem runtime: setup must
 * not open `~/.asem/state.db`, create Sessions, or mutate `.asem.yaml`.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The MVP Integration Target set; matches mikan's installer target set. */
export type IntegrationTarget =
  | "pi"
  | "antigravity"
  | "jcode"
  | "claude-code"
  | "opencode"
  | "codex"
  | "copilot-vscode"
  | "copilot-cli";

/** Where a target's config was written. `cli-global` is a CLI-scoped global. */
export type InstallScope = "global" | "workspace" | "cli-global";

/** Injected roots/flags for one install. Global is the default scope. */
export type InstallOptions = {
  global?: boolean;
  cwd?: string;
  home?: string;
};

/** Result of a Skill (or generic) install: where it landed and at what scope. */
export type InstallResult = {
  target: IntegrationTarget;
  path: string;
  scope: InstallScope;
};

/** Stable, test-friendly error codes for Integration Target setup. */
export type IntegrationTargetErrorCode =
  | "unknown_target"
  | "unsupported_scope"
  | "invalid_config"
  | "io_error";

/** A setup error carrying a stable {@link IntegrationTargetErrorCode}. */
export class IntegrationTargetError extends Error {
  readonly code: IntegrationTargetErrorCode;
  readonly path?: string;

  constructor(
    code: IntegrationTargetErrorCode,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = "IntegrationTargetError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

export function integrationTargetError(
  code: IntegrationTargetErrorCode,
  message: string,
  path?: string,
): IntegrationTargetError {
  return new IntegrationTargetError(code, message, path);
}

/** Global is the default scope unless the caller passes `global: false`. */
export function isGlobalScope(options: InstallOptions): boolean {
  return options.global !== false;
}

/** Resolve a path under the injected (or real) user home directory. */
export function homePath(
  options: InstallOptions,
  ...segments: string[]
): string {
  return join(options.home ?? homedir(), ...segments);
}

/** Resolve a path under the injected (or real) working directory. */
export function workspacePath(
  options: InstallOptions,
  ...segments: string[]
): string {
  return resolve(options.cwd ?? process.cwd(), ...segments);
}

export type JsonObject = Record<string, unknown>;

/**
 * Read a JSON object config, or `{}` when the file is missing. Invalid JSON or
 * a non-object top level throws `invalid_config` so setup never silently
 * overwrites a malformed file with an empty config.
 */
export function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw integrationTargetError(
      "invalid_config",
      `Invalid JSON config at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw integrationTargetError(
      "invalid_config",
      `Expected JSON object config at ${path}`,
      path,
    );
  }
  return parsed as JsonObject;
}

/** Read a nested object property, treating missing as `{}` and rejecting non-objects. */
export function objectProperty(config: JsonObject, key: string): JsonObject {
  const value = config[key];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw integrationTargetError(
      "invalid_config",
      `Expected object at config key ${key}`,
    );
  }
  return value as JsonObject;
}

/** Atomic temp-file-and-rename write that preserves an existing file mode. */
export function writeTextFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  writeFileSync(tmpPath, contents, "utf8");
  chmodSync(tmpPath, mode);
  renameSync(tmpPath, path);
}

export function writeJsonObjectAtomic(path: string, config: JsonObject): void {
  writeTextFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}
