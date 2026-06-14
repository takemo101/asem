# Integration Target Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build CLI-only `asem mcp add --for <target>` and `asem skills add --for <target>` installers for supported Integration Targets.

**Architecture:** Add a new `@asem/integrations` package that owns target registries, MCP config adapters, Skill path adapters, shared Skill text, and atomic file writes. Keep `@asem/cli` as a thin parser/renderer/dispatcher; do not route installer behavior through `@asem/ops` or expose it through `@asem/mcp`.

**Tech Stack:** TypeScript, Bun tests, Node `fs`/`path` helpers, existing asem CLI parse/run/render/help patterns, mikan adapter design as reference.

---

## Reference docs

Read these before implementing:

- `CONTEXT.md` — Integration Target glossary and Agent distinction.
- `docs/designs/integration-targets-design.md` — source of truth for this feature.
- `docs/architecture/overview.md` — package boundary for `@asem/integrations`.
- `/Users/takemo101/Desktop/workspace/mikan/packages/mcp/src/installers/` — reference MCP adapter pattern.
- `/Users/takemo101/Desktop/workspace/mikan/packages/mcp/src/skills/` — reference Skill installer pattern.

## File structure

Create:

- `packages/integrations/package.json` — package metadata and workspace export.
- `packages/integrations/src/index.ts` — public exports.
- `packages/integrations/src/shared.ts` — target/scope/result types, path helpers, atomic writes, shared JSON helpers, common errors.
- `packages/integrations/src/mcp/index.ts` — MCP target registry and `installMcpServerForTarget`.
- `packages/integrations/src/mcp/json-adapter.ts` — shared JSON map merge helper for `mcpServers`-style targets.
- `packages/integrations/src/mcp/codex.ts` — Codex TOML adapter.
- `packages/integrations/src/mcp/targets.ts` — target adapters for pi, antigravity, jcode, claude-code, opencode, copilot-vscode, copilot-cli, plus codex export.
- `packages/integrations/src/skills/index.ts` — Skill target registry and `installSkillForTarget`.
- `packages/integrations/src/skills/document.ts` — shared asem Skill document.
- `packages/integrations/src/skills/targets.ts` — Skill path adapters for all targets.
- `packages/integrations/test/mcp.test.ts` — MCP installer unit tests.
- `packages/integrations/test/skills.test.ts` — Skill installer unit tests.
- `packages/integrations/test/shared.test.ts` — atomic write / merge safety tests.

Modify:

- `packages/cli/package.json` — add `@asem/integrations` workspace dependency.
- `packages/cli/src/parse.ts` — parse `mcp add --for <target> [--no-global]` and `skills add --for <target> [--no-global]`.
- `packages/cli/src/run.ts` — dispatch integration commands without `@asem/ops`.
- `packages/cli/src/usage.ts` — document new command forms.
- `packages/cli/src/main.ts` — ensure `asem mcp add` does not start stdio MCP server and does not create full runtime deps unnecessarily.
- `packages/cli/test/parse.test.ts` — parser coverage.
- `packages/cli/test/run.test.ts` — CLI behavior coverage with fake installers.
- `packages/cli/test/main.test.ts` — surface/runtime-deps coverage for `mcp add` / `skills add`.
- `packages/cli/test/docs-links.test.ts` — no change expected unless docs test needs new include behavior.
- `docs/designs/integration-targets-design.md` — update only if implementation reveals a documented target path correction.

## Task 1: Scaffold `@asem/integrations`

**Files:**

- Create: `packages/integrations/package.json`
- Create: `packages/integrations/src/index.ts`
- Create: `packages/integrations/src/shared.ts`
- Create: `packages/integrations/test/shared.test.ts`

- [ ] **Step 1: Write failing shared package tests**

Create `packages/integrations/test/shared.test.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  homePath,
  integrationTargetError,
  readJsonObject,
  writeJsonObjectAtomic,
  workspacePath,
} from "../src/shared.ts";

describe("integration shared helpers", () => {
  test("resolves home and workspace paths from injected roots", () => {
    expect(homePath({ home: "/home/test" }, ".config", "mcp", "mcp.json")).toBe(
      "/home/test/.config/mcp/mcp.json",
    );
    expect(workspacePath({ cwd: "/repo" }, ".mcp.json")).toBe("/repo/.mcp.json");
  });

  test("readJsonObject returns an empty object for a missing file", () => {
    const dir = mktemp();
    expect(readJsonObject(join(dir, "missing.json"))).toEqual({});
  });

  test("readJsonObject rejects invalid JSON", () => {
    const dir = mktemp();
    const path = join(dir, "bad.json");
    Bun.write(path, "{");
    expect(() => readJsonObject(path)).toThrow("invalid JSON");
  });

  test("writeJsonObjectAtomic creates parents and preserves existing mode", () => {
    const dir = mktemp();
    const path = join(dir, "nested", "config.json");
    writeJsonObjectAtomic(path, { a: 1 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 1 });
    chmodSync(path, 0o640);
    writeJsonObjectAtomic(path, { b: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ b: 2 });
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
  });

  test("integrationTargetError carries a stable code", () => {
    const error = integrationTargetError("unknown_target", "Unknown Integration Target: nope");
    expect(error.code).toBe("unknown_target");
    expect(error.message).toBe("Unknown Integration Target: nope");
  });
});

function mktemp(): string {
  return `${process.cwd()}/.tmp-integrations-${crypto.randomUUID()}`;
}
```

- [ ] **Step 2: Run the failing test**

Run:

```sh
bun test packages/integrations/test/shared.test.ts
```

Expected: FAIL because `@asem/integrations` files do not exist.

- [ ] **Step 3: Add package metadata and shared helpers**

Create `packages/integrations/package.json`:

```json
{
  "name": "@asem/integrations",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "asem Integration Target MCP and Skill installers",
  "main": "src/index.ts",
  "module": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  }
}
```

Create `packages/integrations/src/shared.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type IntegrationTarget =
  | "pi"
  | "antigravity"
  | "jcode"
  | "claude-code"
  | "opencode"
  | "codex"
  | "copilot-vscode"
  | "copilot-cli";

export type InstallScope = "global" | "workspace" | "cli-global";

export type InstallOptions = {
  global?: boolean;
  cwd?: string;
  home?: string;
};

export type InstallResult = {
  target: IntegrationTarget;
  path: string;
  scope: InstallScope;
};

export type IntegrationTargetErrorCode =
  | "unknown_target"
  | "unsupported_scope"
  | "invalid_config"
  | "io_error";

export class IntegrationTargetError extends Error {
  readonly code: IntegrationTargetErrorCode;
  readonly path?: string;

  constructor(code: IntegrationTargetErrorCode, message: string, path?: string) {
    super(message);
    this.name = "IntegrationTargetError";
    this.code = code;
    this.path = path;
  }
}

export function integrationTargetError(
  code: IntegrationTargetErrorCode,
  message: string,
  path?: string,
): IntegrationTargetError {
  return new IntegrationTargetError(code, message, path);
}

export function isGlobalScope(options: InstallOptions): boolean {
  return options.global !== false;
}

export function homePath(options: InstallOptions, ...segments: string[]): string {
  return join(options.home ?? homedir(), ...segments);
}

export function workspacePath(options: InstallOptions, ...segments: string[]): string {
  return resolve(options.cwd ?? process.cwd(), ...segments);
}

export type JsonObject = Record<string, unknown>;

export function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw integrationTargetError(
      "invalid_config",
      `Invalid JSON config at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw integrationTargetError("invalid_config", `Expected JSON object config at ${path}`, path);
  }
  return parsed as JsonObject;
}

export function objectProperty(config: JsonObject, key: string): JsonObject {
  const value = config[key];
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw integrationTargetError("invalid_config", `Expected object at config key ${key}`);
  }
  return value as JsonObject;
}

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
```

Create `packages/integrations/src/index.ts`:

```ts
export * from "./shared.ts";
```

- [ ] **Step 4: Verify shared tests pass**

Run:

```sh
bun test packages/integrations/test/shared.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Use GitButler, not git:

```sh
but status -fv
but commit <branch-name> -m "Add integration target package scaffold" --changes <ids-for-packages/integrations-files>
```

## Task 2: Implement MCP installers

**Files:**

- Create: `packages/integrations/src/mcp/index.ts`
- Create: `packages/integrations/src/mcp/json-adapter.ts`
- Create: `packages/integrations/src/mcp/codex.ts`
- Create: `packages/integrations/src/mcp/targets.ts`
- Modify: `packages/integrations/src/index.ts`
- Create: `packages/integrations/test/mcp.test.ts`

- [ ] **Step 1: Write failing MCP installer tests**

Create `packages/integrations/test/mcp.test.ts`:

```ts
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { installMcpServerForTarget } from "../src/mcp/index.ts";

const allTargets = [
  "pi",
  "antigravity",
  "jcode",
  "claude-code",
  "opencode",
  "codex",
  "copilot-vscode",
  "copilot-cli",
] as const;

describe("installMcpServerForTarget", () => {
  test("supports the mikan parity target set", () => {
    const home = mktemp();
    for (const target of allTargets) {
      const result = installMcpServerForTarget(target, {
        home,
        cwd: join(home, "repo"),
        global: target === "copilot-vscode" ? false : true,
      });
      expect(result.target).toBe(target);
      expect(result.serverName).toBe("asem");
      expect(result.path.length).toBeGreaterThan(0);
    }
  });

  test("pi global writes mcpServers.asem", () => {
    const home = mktemp();
    const result = installMcpServerForTarget("pi", { home });
    expect(result).toEqual({
      target: "pi",
      path: join(home, ".config", "mcp", "mcp.json"),
      scope: "global",
      serverName: "asem",
    });
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
  });

  test("claude-code workspace writes .mcp.json", () => {
    const cwd = join(mktemp(), "repo");
    const result = installMcpServerForTarget("claude-code", { cwd, global: false });
    expect(result.path).toBe(join(cwd, ".mcp.json"));
    expect(result.scope).toBe("workspace");
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      mcpServers: { asem: { command: "asem", args: ["mcp"] } },
    });
  });

  test("upserts only the asem entry and preserves other servers", () => {
    const home = mktemp();
    const path = join(home, ".config", "mcp", "mcp.json");
    mkdirSync(dirname(path), { recursive: true });
    Bun.write(
      path,
      JSON.stringify({ mcpServers: { other: { command: "other" }, asem: { command: "old" } } }),
    );
    installMcpServerForTarget("pi", { home });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mcpServers: {
        other: { command: "other" },
        asem: { command: "asem", args: ["mcp"] },
      },
    });
  });

  test("codex rejects workspace scope", () => {
    expect(() =>
      installMcpServerForTarget("codex", { cwd: mktemp(), global: false }),
    ).toThrow("codex does not support workspace MCP scope");
  });

  test("unknown target fails", () => {
    expect(() => installMcpServerForTarget("nope", { home: mktemp() })).toThrow(
      "Unknown Integration Target: nope",
    );
  });
});

function mktemp(): string {
  return `${process.cwd()}/.tmp-integrations-${crypto.randomUUID()}`;
}
```

- [ ] **Step 2: Run the failing MCP tests**

Run:

```sh
bun test packages/integrations/test/mcp.test.ts
```

Expected: FAIL because MCP installers do not exist.

- [ ] **Step 3: Implement JSON adapter and registry**

Create `packages/integrations/src/mcp/json-adapter.ts`:

```ts
import {
  type InstallOptions,
  type InstallResult,
  type InstallScope,
  type IntegrationTarget,
  type JsonObject,
  objectProperty,
  readJsonObject,
  writeJsonObjectAtomic,
} from "../shared.ts";

export type McpServerEntry = JsonObject;

export type McpInstallResult = InstallResult & {
  serverName: string;
};

export type JsonMcpTargetAdapter = {
  target: IntegrationTarget;
  serversKey: string;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
  buildEntry(): McpServerEntry;
};

export function installJsonMcpServer(
  adapter: JsonMcpTargetAdapter,
  options: InstallOptions,
): McpInstallResult {
  const { path, scope } = adapter.resolveTarget(options);
  const config = readJsonObject(path);
  const servers = objectProperty(config, adapter.serversKey);
  servers.asem = adapter.buildEntry();
  config[adapter.serversKey] = servers;
  writeJsonObjectAtomic(path, config);
  return { target: adapter.target, path, scope, serverName: "asem" };
}

export function stdioEntry(): McpServerEntry {
  return { command: "asem", args: ["mcp"] };
}
```

Create `packages/integrations/src/mcp/targets.ts` with JSON-style adapters copied from mikan paths and entry shapes:

```ts
import {
  homePath,
  type InstallOptions,
  integrationTargetError,
  isGlobalScope,
  workspacePath,
} from "../shared.ts";
import { type JsonMcpTargetAdapter, stdioEntry } from "./json-adapter.ts";

export const jsonMcpTargets: JsonMcpTargetAdapter[] = [
  {
    target: "pi",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".config", "mcp", "mcp.json"), scope: "global" }
        : { path: workspacePath(options, ".mcp.json"), scope: "workspace" },
    buildEntry: stdioEntry,
  },
  {
    target: "claude-code",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".claude.json"), scope: "global" }
        : { path: workspacePath(options, ".mcp.json"), scope: "workspace" },
    buildEntry: stdioEntry,
  },
  {
    target: "jcode",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".jcode", "mcp.json"), scope: "global" }
        : { path: workspacePath(options, ".jcode", "mcp.json"), scope: "workspace" },
    buildEntry: stdioEntry,
  },
  {
    target: "opencode",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".config", "opencode", "opencode.json"), scope: "global" }
        : { path: workspacePath(options, ".opencode", "opencode.json"), scope: "workspace" },
    buildEntry: () => ({ command: ["asem", "mcp"] }),
  },
  {
    target: "antigravity",
    serversKey: "mcpServers",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".gemini", "antigravity", "mcp_config.json"), scope: "global" }
        : { path: workspacePath(options, ".gemini", "antigravity", "mcp_config.json"), scope: "workspace" },
    buildEntry: stdioEntry,
  },
  {
    target: "copilot-vscode",
    serversKey: "servers",
    resolveTarget: (options) => {
      if (isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "copilot-vscode does not support global MCP scope; re-run with --no-global",
        );
      }
      return { path: workspacePath(options, ".vscode", "mcp.json"), scope: "workspace" };
    },
    buildEntry: () => ({ type: "stdio", command: "asem", args: ["mcp"] }),
  },
  {
    target: "copilot-cli",
    serversKey: "mcpServers",
    resolveTarget: (options) => {
      if (!isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "copilot-cli does not support workspace MCP scope",
        );
      }
      return { path: homePath(options, ".config", "github-copilot", "mcp.json"), scope: "global" };
    },
    buildEntry: stdioEntry,
  },
];
```

Create `packages/integrations/src/mcp/codex.ts` with a minimal TOML updater. Preserve unrelated file text by replacing or appending only `[mcp_servers.asem]` block:

```ts
import { existsSync, readFileSync } from "node:fs";
import {
  homePath,
  type InstallOptions,
  type IntegrationTarget,
  integrationTargetError,
  isGlobalScope,
  writeTextFileAtomic,
} from "../shared.ts";
import type { McpInstallResult } from "./json-adapter.ts";

const target: IntegrationTarget = "codex";

export function installCodexMcpServer(options: InstallOptions): McpInstallResult {
  if (!isGlobalScope(options)) {
    throw integrationTargetError("unsupported_scope", "codex does not support workspace MCP scope");
  }
  const path = homePath(options, ".codex", "config.toml");
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = upsertCodexAsemBlock(current);
  writeTextFileAtomic(path, next);
  return { target, path, scope: "global", serverName: "asem" };
}

export function upsertCodexAsemBlock(input: string): string {
  const block = '[mcp_servers.asem]\ncommand = "asem"\nargs = ["mcp"]\n';
  const pattern = /(^|\n)\[mcp_servers\.asem\]\n(?:[^\n]*\n?)*?(?=\n\[[^\n]+\]|$)/m;
  if (pattern.test(input)) {
    return input.replace(pattern, (match, prefix: string) => `${prefix}${block}`);
  }
  const trimmed = input.endsWith("\n") || input.length === 0 ? input : `${input}\n`;
  return `${trimmed}${trimmed.length > 0 ? "\n" : ""}${block}`;
}
```

Create `packages/integrations/src/mcp/index.ts`:

```ts
import { type InstallOptions, integrationTargetError } from "../shared.ts";
import { installCodexMcpServer } from "./codex.ts";
import { installJsonMcpServer, type McpInstallResult } from "./json-adapter.ts";
import { jsonMcpTargets } from "./targets.ts";

export type { McpInstallResult } from "./json-adapter.ts";

export function installMcpServerForTarget(
  target: string,
  options: InstallOptions = {},
): McpInstallResult {
  if (target === "codex") return installCodexMcpServer(options);
  const adapter = jsonMcpTargets.find((entry) => entry.target === target);
  if (!adapter) throw integrationTargetError("unknown_target", `Unknown Integration Target: ${target}`);
  return installJsonMcpServer(adapter, options);
}
```

Update `packages/integrations/src/index.ts`:

```ts
export * from "./shared.ts";
export * from "./mcp/index.ts";
```

- [ ] **Step 4: Verify MCP tests pass**

Run:

```sh
bun test packages/integrations/test/mcp.test.ts
```

Expected: PASS. If target paths differ from current mikan implementation, check mikan source and update the test plus `docs/designs/integration-targets-design.md` if the behavior is user-visible.

- [ ] **Step 5: Commit**

```sh
but status -fv
but commit <branch-name> -m "Add MCP installers for Integration Targets" --changes <ids-for-mcp-files-and-tests>
```

## Task 3: Implement Skill installers

**Files:**

- Create: `packages/integrations/src/skills/document.ts`
- Create: `packages/integrations/src/skills/targets.ts`
- Create: `packages/integrations/src/skills/index.ts`
- Modify: `packages/integrations/src/index.ts`
- Create: `packages/integrations/test/skills.test.ts`

- [ ] **Step 1: Write failing Skill installer tests**

Create `packages/integrations/test/skills.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { installSkillForTarget, skillDocument } from "../src/skills/index.ts";

const allTargets = [
  "pi",
  "antigravity",
  "jcode",
  "claude-code",
  "opencode",
  "codex",
  "copilot-vscode",
  "copilot-cli",
] as const;

describe("installSkillForTarget", () => {
  test("supports the mikan parity target set", () => {
    const home = mktemp();
    for (const target of allTargets) {
      const result = installSkillForTarget(target, {
        home,
        cwd: join(home, "repo"),
        global: target === "copilot-vscode" ? false : true,
      });
      expect(result.target).toBe(target);
      expect(readFileSync(result.path, "utf8")).toBe(skillDocument);
    }
  });

  test("pi workspace writes .pi/skills/asem/SKILL.md", () => {
    const cwd = join(mktemp(), "repo");
    const result = installSkillForTarget("pi", { cwd, global: false });
    expect(result).toEqual({
      target: "pi",
      path: join(cwd, ".pi", "skills", "asem", "SKILL.md"),
      scope: "workspace",
    });
  });

  test("codex rejects workspace skills when unsupported", () => {
    expect(() => installSkillForTarget("codex", { cwd: mktemp(), global: false })).toThrow(
      "codex does not support workspace Skill scope",
    );
  });

  test("unknown target fails", () => {
    expect(() => installSkillForTarget("nope", { home: mktemp() })).toThrow(
      "Unknown Integration Target: nope",
    );
  });
});

function mktemp(): string {
  return `${process.cwd()}/.tmp-integrations-${crypto.randomUUID()}`;
}
```

- [ ] **Step 2: Run the failing Skill tests**

Run:

```sh
bun test packages/integrations/test/skills.test.ts
```

Expected: FAIL because Skill installers do not exist.

- [ ] **Step 3: Add shared Skill document**

Create `packages/integrations/src/skills/document.ts`:

```ts
const frontmatter = `---
name: asem
description: asem is a local Session manager for AI agents running in terminal multiplexers. Use it to create, find, message, report from, attach to, close, and inspect local Sessions without inventing task or workflow outcomes.
---`;

const body = `# asem

asem is a local agent Session manager. It manages live AI CLI Sessions running inside terminal multiplexers and records durable Messages and Reports.

Prefer asem MCP tools when they are available. Fall back to the \`asem\` CLI when MCP is unavailable.

## Vocabulary

Use these terms precisely:

- Session: a registered agent CLI process running inside a Multiplexer pane.
- Message: durable communication from one Session or human operator to another Session.
- Report: a Message from a child Session to its Parent Session.
- Workspace: a logical grouping for related work.
- Worktree Root: the filesystem root that isolates a working copy.
- Effective Scope: Workspace plus Worktree Root.
- Multiplexer: the terminal environment that owns a live pane, such as herdr, tmux, rmux, or zellij.
- Agent: the external AI CLI process launched inside a Session.
- Agent Profile: explicit prompt-shaping instructions for a new Session.
- Integration Target: an external AI client whose local config can be updated to know how to use asem.

## Boundaries

Do not treat asem as a task manager, workflow engine, team coordinator, scheduler, or result judge. Session status is process or connection state only. A Report does not mean completion. A Message is not an event stream or unread queue.

Do not edit token-bearing or generated runtime state under \`.asem/sessions/\`, \`.asem/tokens/\`, or \`.asem/current-session*.json\` directly.
`;

export const skillDocument = `${frontmatter}\n\n${body}`;
```

- [ ] **Step 4: Add Skill target adapters**

Create `packages/integrations/src/skills/targets.ts` using mikan paths with `asem` replacing `mikan` in Skill directory names. For targets where mikan rejects workspace scope, preserve that behavior:

```ts
import {
  homePath,
  type InstallOptions,
  type InstallScope,
  type IntegrationTarget,
  integrationTargetError,
  isGlobalScope,
  workspacePath,
} from "../shared.ts";

export type SkillTargetAdapter = {
  target: IntegrationTarget;
  resolveTarget(options: InstallOptions): { path: string; scope: InstallScope };
};

export const skillTargets: SkillTargetAdapter[] = [
  {
    target: "pi",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".pi", "agent", "skills", "asem", "SKILL.md"), scope: "global" }
        : { path: workspacePath(options, ".pi", "skills", "asem", "SKILL.md"), scope: "workspace" },
  },
  {
    target: "claude-code",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".claude", "skills", "asem", "SKILL.md"), scope: "global" }
        : { path: workspacePath(options, ".claude", "skills", "asem", "SKILL.md"), scope: "workspace" },
  },
  {
    target: "codex",
    resolveTarget: (options) => {
      if (!isGlobalScope(options)) {
        throw integrationTargetError("unsupported_scope", "codex does not support workspace Skill scope");
      }
      return { path: homePath(options, ".codex", "skills", "asem", "SKILL.md"), scope: "global" };
    },
  },
  {
    target: "opencode",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".config", "opencode", "skills", "asem", "SKILL.md"), scope: "global" }
        : { path: workspacePath(options, ".opencode", "skills", "asem", "SKILL.md"), scope: "workspace" },
  },
  {
    target: "jcode",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".jcode", "skills", "asem", "SKILL.md"), scope: "global" }
        : { path: workspacePath(options, ".jcode", "skills", "asem", "SKILL.md"), scope: "workspace" },
  },
  {
    target: "antigravity",
    resolveTarget: (options) =>
      isGlobalScope(options)
        ? { path: homePath(options, ".gemini", "antigravity", "skills", "asem", "SKILL.md"), scope: "global" }
        : { path: workspacePath(options, ".gemini", "antigravity", "skills", "asem", "SKILL.md"), scope: "workspace" },
  },
  {
    target: "copilot-vscode",
    resolveTarget: (options) => {
      if (isGlobalScope(options)) {
        throw integrationTargetError(
          "unsupported_scope",
          "copilot-vscode does not support global Skill scope; re-run with --no-global",
        );
      }
      return { path: workspacePath(options, ".github", "instructions", "asem.instructions.md"), scope: "workspace" };
    },
  },
  {
    target: "copilot-cli",
    resolveTarget: (options) => {
      if (!isGlobalScope(options)) {
        throw integrationTargetError("unsupported_scope", "copilot-cli does not support workspace Skill scope");
      }
      return { path: homePath(options, ".config", "github-copilot", "instructions", "asem.instructions.md"), scope: "global" };
    },
  },
];
```

- [ ] **Step 5: Add Skill installer registry**

Create `packages/integrations/src/skills/index.ts`:

```ts
import { type InstallOptions, type InstallResult, integrationTargetError, writeTextFileAtomic } from "../shared.ts";
import { skillDocument } from "./document.ts";
import { skillTargets } from "./targets.ts";

export { skillDocument } from "./document.ts";

export function installSkillForTarget(target: string, options: InstallOptions = {}): InstallResult {
  const adapter = skillTargets.find((entry) => entry.target === target);
  if (!adapter) throw integrationTargetError("unknown_target", `Unknown Integration Target: ${target}`);
  const { path, scope } = adapter.resolveTarget(options);
  writeTextFileAtomic(path, skillDocument);
  return { target: adapter.target, path, scope };
}
```

Update `packages/integrations/src/index.ts`:

```ts
export * from "./shared.ts";
export * from "./mcp/index.ts";
export * from "./skills/index.ts";
```

- [ ] **Step 6: Verify Skill tests pass**

Run:

```sh
bun test packages/integrations/test/skills.test.ts
```

Expected: PASS. If paths conflict with current mikan target conventions, inspect mikan before changing behavior.

- [ ] **Step 7: Commit**

```sh
but status -fv
but commit <branch-name> -m "Add Skill installers for Integration Targets" --changes <ids-for-skill-files-and-tests>
```

## Task 4: Wire CLI parse and help

**Files:**

- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/parse.ts`
- Modify: `packages/cli/src/usage.ts`
- Modify: `packages/cli/test/parse.test.ts`

- [ ] **Step 1: Write failing parse tests**

Add to `packages/cli/test/parse.test.ts`:

```ts
describe("parseArgs integrations", () => {
  test("mcp add maps --for and defaults global", () => {
    expect(parseArgs(["mcp", "add", "--for", "pi"])).toEqual({
      kind: "command",
      command: { type: "mcp-add", target: "pi", global: true },
    });
  });

  test("mcp add maps --no-global", () => {
    expect(parseArgs(["mcp", "add", "--for", "pi", "--no-global"])).toEqual({
      kind: "command",
      command: { type: "mcp-add", target: "pi", global: false },
    });
  });

  test("mcp with no subcommand still maps to the stdio server command", () => {
    expect(parseArgs(["mcp"])).toEqual({ kind: "command", command: { type: "mcp" } });
  });

  test("mcp add requires --for", () => {
    expect(parseArgs(["mcp", "add"])).toMatchObject({ kind: "error" });
  });

  test("skills add maps --for", () => {
    expect(parseArgs(["skills", "add", "--for", "claude-code"])).toEqual({
      kind: "command",
      command: { type: "skills-add", target: "claude-code", global: true },
    });
  });

  test("skills add maps --no-global", () => {
    expect(parseArgs(["skills", "add", "--for", "pi", "--no-global"])).toEqual({
      kind: "command",
      command: { type: "skills-add", target: "pi", global: false },
    });
  });
});
```

- [ ] **Step 2: Run failing parse tests**

Run:

```sh
bun test packages/cli/test/parse.test.ts
```

Expected: FAIL because command types and parser branches are missing.

- [ ] **Step 3: Add CLI dependency**

In `packages/cli/package.json`, add:

```json
"@asem/integrations": "workspace:*"
```

- [ ] **Step 4: Update command union and parser**

In `packages/cli/src/parse.ts`, extend `CliCommand` with:

```ts
| { type: "mcp-add"; target: string; global: boolean }
| { type: "skills-add"; target: string; global: boolean }
```

Add helper:

```ts
function parseIntegrationAdd(kind: "mcp-add" | "skills-add", args: string[]): ParseResult {
  const flags = parseFlags(args, { booleans: ["no-global"], values: ["for"] });
  if (!flags.ok) return { kind: "error", error: flags.error };
  const target = flags.value.values.get("for");
  if (target === undefined) {
    return invalid(`${kind === "mcp-add" ? "mcp" : "skills"} add requires --for <target>`);
  }
  if (flags.value.positionals.length > 0) {
    return invalid(`unexpected argument: ${flags.value.positionals[0]}`);
  }
  return {
    kind: "command",
    command: { type: kind, target, global: !flags.value.booleans.has("no-global") },
  };
}
```

Adjust the top-level `parseArgs` handling:

```ts
case "mcp":
  if (rest[0] === "add") return parseIntegrationAdd("mcp-add", rest.slice(1));
  if (rest.length === 0) return { kind: "command", command: { type: "mcp" } };
  return invalid(`unexpected argument for mcp: ${rest[0]}`);
case "skills":
  if (rest[0] === "add") return parseIntegrationAdd("skills-add", rest.slice(1));
  return invalid("missing skills subcommand (add)");
```

Update help topic handling so `asem skills --help`, `asem skills add --help`, `asem mcp add --help`, and `asem mcp --help` resolve to focused help pages.

- [ ] **Step 5: Update usage pages**

In `packages/cli/src/usage.ts`, change MCP usage to include both forms and add Skills usage:

```ts
const MCP_USAGE = [
  "asem mcp — start the AI-facing MCP server or install MCP registration",
  "",
  "usage:",
  "  asem mcp",
  "  asem mcp add --for <target> [--no-global]",
  "",
  "notes:",
  "  Without a subcommand, serves the asem tools over stdio for an MCP client.",
  "  With add, registers the fixed asem MCP server entry in an Integration Target.",
];

const SKILLS_USAGE = [
  "asem skills — install asem Skill instructions for an Integration Target",
  "",
  "usage:",
  "  asem skills add --for <target> [--no-global]",
  "",
  "options:",
  "  --for <target>  Integration Target such as pi, claude-code, codex, or opencode",
  "  --no-global     install workspace-local config when the target supports it",
];
```

Add `skills` and `skills add` to `PAGES`.

- [ ] **Step 6: Verify parse tests pass**

Run:

```sh
bun test packages/cli/test/parse.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
but status -fv
but commit <branch-name> -m "Parse Integration Target setup commands" --changes <ids-for-cli-parse-help-files>
```

## Task 5: Wire CLI dispatch without full runtime deps

**Files:**

- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/run.test.ts`
- Modify: `packages/cli/test/main.test.ts`

- [ ] **Step 1: Write failing run tests**

In `packages/cli/test/run.test.ts`, add tests with fake installers exposed through `RunCliOptions`:

```ts
test("mcp add installs MCP registration and renders target/path/scope", async () => {
  const io = createTestIo();
  const exit = await runCli({
    argv: ["mcp", "add", "--for", "pi"],
    cwd: "/repo",
    deps: fakeOpsDeps(),
    io,
    integrations: {
      installMcpServerForTarget: (target, options) => ({
        target: target as never,
        path: `${options.home ?? "/home/test"}/.config/mcp/mcp.json`,
        scope: "global",
        serverName: "asem",
      }),
      installSkillForTarget: unreachableSkillInstaller,
    },
  });
  expect(exit).toBe(0);
  expect(io.stdout.join("\n")).toContain("Registered MCP server 'asem' for pi (global)");
});

test("skills add installs Skill and renders target/path/scope", async () => {
  const io = createTestIo();
  const exit = await runCli({
    argv: ["skills", "add", "--for", "pi", "--no-global"],
    cwd: "/repo",
    deps: fakeOpsDeps(),
    io,
    integrations: {
      installMcpServerForTarget: unreachableMcpInstaller,
      installSkillForTarget: (target, options) => ({
        target: target as never,
        path: `${options.cwd}/.pi/skills/asem/SKILL.md`,
        scope: "workspace",
      }),
    },
  });
  expect(exit).toBe(0);
  expect(io.stdout.join("\n")).toContain("Installed asem Skill for pi (workspace)");
});
```

Use helper functions consistent with existing `run.test.ts` helpers. If `RunCliOptions` injection names differ during implementation, keep the behavior identical.

- [ ] **Step 2: Run failing run tests**

Run:

```sh
bun test packages/cli/test/run.test.ts
```

Expected: FAIL because `integrations` option and dispatch cases do not exist.

- [ ] **Step 3: Add dispatch seam and renderers**

In `packages/cli/src/run.ts`, import production installers:

```ts
import { installMcpServerForTarget, installSkillForTarget } from "@asem/integrations";
import type { InstallOptions, InstallResult } from "@asem/integrations";
import type { McpInstallResult } from "@asem/integrations";
```

Extend `RunCliOptions`:

```ts
integrations?: {
  installMcpServerForTarget?: (target: string, options: InstallOptions) => McpInstallResult;
  installSkillForTarget?: (target: string, options: InstallOptions) => InstallResult;
};
home?: string;
```

Add dispatch cases:

```ts
case "mcp-add": {
  const install = opts.integrations?.installMcpServerForTarget ?? installMcpServerForTarget;
  try {
    const result = install(command.target, { cwd, home: opts.home, global: command.global });
    emit(io, [
      `Registered MCP server '${result.serverName}' for ${result.target} (${result.scope}): ${result.path}`,
    ]);
    return EXIT_OK;
  } catch (error) {
    return fail(io, operationError("invalid_input", error instanceof Error ? error.message : String(error)));
  }
}
case "skills-add": {
  const install = opts.integrations?.installSkillForTarget ?? installSkillForTarget;
  try {
    const result = install(command.target, { cwd, home: opts.home, global: command.global });
    emit(io, [`Installed asem Skill for ${result.target} (${result.scope}): ${result.path}`]);
    return EXIT_OK;
  } catch (error) {
    return fail(io, operationError("invalid_input", error instanceof Error ? error.message : String(error)));
  }
}
```

If `operationError` requires a details argument, pass `{}` or the existing helper shape used elsewhere in `run.ts`.

- [ ] **Step 4: Ensure `main.ts` does not start MCP for `mcp add`**

Find the branch that starts `runMcpStdio` for `argv[0] === "mcp"`. Change it so only bare `asem mcp` starts stdio:

```ts
if (argv[0] === "mcp" && argv[1] === undefined && !wantsHelp(argv)) {
  return runMcpStdio(...);
}
```

`asem mcp add ...` must fall through to `runCli`.

- [ ] **Step 5: Add main surface tests**

In `packages/cli/test/main.test.ts`, add a test that `surfaceForArgv(["mcp", "add", "--for", "pi"])` returns `cli`, not `mcp`, or adjust the existing helper expectation to the actual function signature.

Also add a test mirroring doctor's read-only behavior: `asem mcp add --for pi` with injected integrations must not touch durable store deps. Use the existing read-only deps test pattern for doctor.

- [ ] **Step 6: Verify CLI tests pass**

Run:

```sh
bun test packages/cli/test/run.test.ts packages/cli/test/main.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```sh
but status -fv
but commit <branch-name> -m "Wire CLI Integration Target setup commands" --changes <ids-for-cli-dispatch-files>
```

## Task 6: Final validation and docs touch-up

**Files:**

- Modify only if needed: `docs/designs/integration-targets-design.md`
- Modify only if needed: `docs/README.md`, `docs/designs/README.md`, `docs/architecture/overview.md`

- [ ] **Step 1: Run package-level tests**

Run:

```sh
bun test packages/integrations/test/shared.test.ts packages/integrations/test/mcp.test.ts packages/integrations/test/skills.test.ts
bun test packages/cli/test/parse.test.ts packages/cli/test/run.test.ts packages/cli/test/main.test.ts packages/cli/test/docs-links.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```sh
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full baseline**

Run:

```sh
bun run check
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test with temp HOME**

Run:

```sh
TMP_HOME="$(mktemp -d)"
bun run asem mcp add --for pi --home "$TMP_HOME"
bun run asem skills add --for pi --home "$TMP_HOME"
find "$TMP_HOME" -type f -maxdepth 6 -print -exec sed -n '1,40p' {} \;
```

If the CLI does not support `--home` as a public flag, skip this exact smoke and instead test through `runCli` injection. Do not add `--home` as public UX unless the design is updated first.

- [ ] **Step 5: Confirm no MCP tools were added**

Run:

```sh
bun test packages/mcp/test/tools.test.ts
```

Expected: PASS with no Integration Target setup tools exposed.

- [ ] **Step 6: Commit any corrections**

If docs or tests needed correction:

```sh
but status -fv
but commit <branch-name> -m "Finalize Integration Target setup implementation" --changes <ids>
```

## Review and merge expectations

- Open a PR after all tasks are complete.
- Request/use an asem reviewer Session with `--profile reviewer` for the implementation PR.
- Reviewer must check:
  - no `.asem.yaml` mutation;
  - no `@asem/mcp` setup tools;
  - `asem mcp` still starts stdio;
  - `asem mcp add` falls through to CLI;
  - setup commands do not open/migrate `~/.asem/state.db`;
  - target adapters preserve unrelated user config.
- Merge only after `bun run check` and review pass.

## Self-review

- Spec coverage: The plan covers Integration Target vocabulary, global default, `--no-global`, mikan parity target set, fixed MCP entry, direct file update, shared Skill document, CLI-only surface, `@asem/integrations`, unsupported scope errors, idempotent upsert, and no `incur`.
- Placeholder scan: No task says TBD/TODO/implement later. Concrete file paths, commands, and code shapes are included.
- Type consistency: The plan consistently uses `IntegrationTarget`, `InstallScope`, `InstallOptions`, `InstallResult`, `McpInstallResult`, `installMcpServerForTarget`, and `installSkillForTarget`.
