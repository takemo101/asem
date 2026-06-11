/**
 * Real port adapters for the installed `asem` binary.
 *
 * These are the composition-root glue that turns `@asem/core` port contracts
 * into actual I/O (filesystem, time, ids, tokens, config discovery, scope
 * resolution). They are imported only by the binary entry (`main.ts`), never by
 * the projection layer or its tests — so default CLI tests stay free of real
 * SQLite, shell, and filesystem (testability rules).
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  access,
  chmod as fsChmod,
  readFile as fsReadFile,
  realpath as fsRealpath,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Clock,
  type CommandRequest,
  type CommandResult,
  type Config,
  type ConfigDiscovery,
  type ConfigLoader,
  type CurrentSessionRef,
  type CurrentSessionResolver,
  configSchema,
  type EffectiveScope,
  type FileSystem,
  type IdGenerator,
  type LivenessProbe,
  type LogFields,
  type Logger,
  type Redactor,
  type ScopeResolver,
  type Session,
  type SessionStatus,
  type TemplateRunner,
  type TokenGenerator,
} from "@asem/core";
import { currentSessionFileFor } from "@asem/ops";
import { SequenceTimeoutError } from "@asem/runtime";

// --- FileSystem -----------------------------------------------------------

/** Node-backed {@link FileSystem} with atomic, mode-aware writes. */
export class NodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf8");
  }

  async writeFileAtomic(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void> {
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(
      tmp,
      contents,
      options?.mode === undefined ? {} : { mode: options.mode },
    );
    if (options?.mode !== undefined) {
      // Ensure the mode is applied even if umask masked it on create.
      await fsChmod(tmp, options.mode);
    }
    await rename(tmp, path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdirp(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async chmod(path: string, mode: number): Promise<void> {
    await fsChmod(path, mode);
  }

  async realpath(path: string): Promise<string> {
    try {
      return await fsRealpath(path);
    } catch {
      return path;
    }
  }
}

// --- Clock / id / token ---------------------------------------------------

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

/** UUID-based id generator; ids are opaque, just unique and non-empty. */
export const uuidIdGenerator: IdGenerator = {
  nextId: () => `s_${randomUUID()}`,
};

/** High-entropy token generator (256 bits, url-safe). */
export const randomTokenGenerator: TokenGenerator = {
  generate: () => randomBytes(32).toString("base64url"),
};

// --- Logger / redactor ----------------------------------------------------

/** Identity redactor seam; token-aware redaction is owned by `@asem/runtime`. */
export const passthroughRedactor: Redactor = { redact: (value) => value };

/** stderr JSON logger. Token material is never passed in by operations. */
export class ConsoleLogger implements Logger {
  constructor(private readonly redactor: Redactor = passthroughRedactor) {}

  private write(level: string, message: string, fields?: LogFields): void {
    const line = JSON.stringify(
      fields === undefined ? { level, message } : { level, message, ...fields },
    );
    process.stderr.write(`${this.redactor.redact(line)}\n`);
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }
}

// --- ConfigLoader ---------------------------------------------------------

const yaml = (Bun as unknown as { YAML: { parse(text: string): unknown } })
  .YAML;

/** Discover and parse `.asem.yaml`, walking up from a start directory. */
export class FileConfigLoader implements ConfigLoader {
  constructor(private readonly fs: FileSystem = new NodeFileSystem()) {}

  async load(startDir: string): Promise<ConfigDiscovery> {
    let dir = startDir;
    // Walk upward to the filesystem root (design "Config discovery").
    for (;;) {
      const configPath = join(dir, ".asem.yaml");
      if (await this.fs.exists(configPath)) {
        return this.parse(configPath);
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return { kind: "not_found" };
      }
      dir = parent;
    }
  }

  private async parse(configPath: string): Promise<ConfigDiscovery> {
    let raw: unknown;
    try {
      raw = yaml.parse(await this.fs.readFile(configPath));
    } catch (error) {
      return {
        kind: "invalid",
        configPath,
        issues: [error instanceof Error ? error.message : String(error)],
      };
    }
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        kind: "invalid",
        configPath,
        issues: parsed.error.issues.map((issue) => issue.message),
      };
    }
    return { kind: "found", config: parsed.data, configPath };
  }
}

// --- ScopeResolver --------------------------------------------------------

/**
 * Resolve Effective Scope: `workspace_id` from config, `worktree_root` from the
 * Git toplevel (realpathed) or the realpathed cwd when not in Git (design
 * "Scope resolution").
 */
export class GitScopeResolver implements ScopeResolver {
  constructor(private readonly fs: FileSystem = new NodeFileSystem()) {}

  async resolve(cwd: string, config: Config): Promise<EffectiveScope> {
    return {
      workspaceId: config.workspace.id,
      worktreeRoot: await this.resolveWorktreeRoot(cwd),
    };
  }

  async resolveWorktreeRoot(cwd: string): Promise<string> {
    const top = this.gitToplevel(cwd);
    return this.fs.realpath(top ?? cwd);
  }

  private gitToplevel(cwd: string): string | null {
    try {
      const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
      });
      if (result.status === 0) {
        const out = result.stdout.trim();
        return out.length > 0 ? out : null;
      }
    } catch {
      // git not installed / not a repo — fall through to cwd.
    }
    return null;
  }
}

// --- CurrentSessionResolver ----------------------------------------------

/** Reads the worktree-local current-session pointer and its token file. */
export class FileCurrentSessionResolver implements CurrentSessionResolver {
  constructor(private readonly fs: FileSystem = new NodeFileSystem()) {}

  async resolve(scope: EffectiveScope): Promise<CurrentSessionRef | null> {
    const envSessionId = process.env.AS_SESSION_ID;
    const envToken = process.env.AS_SESSION_TOKEN;
    if (envSessionId !== undefined && envSessionId !== "" && envToken !== undefined && envToken !== "") {
      return { sessionId: envSessionId, token: envToken, scope };
    }

    const pointerPath = currentSessionFileFor(scope.worktreeRoot);
    if (!(await this.fs.exists(pointerPath))) {
      return null;
    }
    let pointer: {
      sessionId?: unknown;
      tokenFile?: unknown;
      workspaceId?: unknown;
      worktreeRoot?: unknown;
    };
    try {
      pointer = JSON.parse(await this.fs.readFile(pointerPath));
    } catch {
      return null;
    }
    if (
      typeof pointer.sessionId !== "string" ||
      typeof pointer.tokenFile !== "string"
    ) {
      return null;
    }
    const token = (await this.fs.readFile(pointer.tokenFile)).trim();
    const ref: CurrentSessionRef = { sessionId: pointer.sessionId, token };
    if (
      typeof pointer.workspaceId === "string" &&
      typeof pointer.worktreeRoot === "string"
    ) {
      ref.scope = {
        workspaceId: pointer.workspaceId,
        worktreeRoot: pointer.worktreeRoot,
      };
    }
    return ref;
  }
}

// --- LivenessProbe --------------------------------------------------------

/**
 * Minimal liveness probe for the baseline: reports the stored status unchanged.
 * Real mux pane inspection arrives with the mux-template slice; until then the
 * CLI must not fabricate process state (CONTEXT.md; implementation principle 12).
 */
export const storedStatusLivenessProbe: LivenessProbe = {
  check: (session: Session): Promise<SessionStatus> =>
    Promise.resolve(session.status),
};

// --- TemplateRunner -------------------------------------------------------

/**
 * Node-backed {@link TemplateRunner}: the real shell/file/clock side of command
 * sequence execution. The sequence engine (`@asem/runtime`) drives it through
 * this port, so default tests use the fake runner instead (testability rules).
 *
 * A timeout kills the child and throws {@link SequenceTimeoutError}, which the
 * engine maps to a structured `timeout` error. Backgrounded commands are
 * detached and return a pid handle without being awaited.
 */
export class NodeTemplateRunner implements TemplateRunner {
  constructor(private readonly fs: FileSystem = new NodeFileSystem()) {}

  run(request: CommandRequest): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(request.command, {
        shell: true,
        cwd: request.cwd,
        env:
          request.env === undefined
            ? process.env
            : { ...process.env, ...request.env },
        detached: request.background ?? false,
      });

      if (request.background === true) {
        const handle = child.pid === undefined ? "bg" : String(child.pid);
        child.unref();
        resolve({
          stdout: "",
          stderr: "",
          exitCode: 0,
          backgroundHandle: handle,
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        fn();
      };

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      if (request.timeoutMs !== undefined) {
        const timeoutMs = request.timeoutMs;
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(() => reject(new SequenceTimeoutError(timeoutMs)));
        }, timeoutMs);
      }

      child.on("error", (error) => finish(() => reject(error)));
      child.on("close", (code) =>
        finish(() => resolve({ stdout, stderr, exitCode: code ?? 0 })),
      );
    });
  }

  async writeFile(
    path: string,
    contents: string,
    options?: { mode?: number },
  ): Promise<void> {
    await this.fs.writeFileAtomic(path, contents, options);
  }

  async wait(ms: number): Promise<void> {
    await delay(ms);
  }
}
