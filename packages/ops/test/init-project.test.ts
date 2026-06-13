import { describe, expect, test } from "bun:test";
import {
  configPathFor,
  currentSessionFileFor,
  gitignorePathFor,
  initProject,
  RUNTIME_GITIGNORE_RULES,
  sessionDirFor,
  tokenFileFor,
} from "../src/index.ts";
import {
  FakeFileSystem,
  FakeScopeResolver,
  MemoryLogger,
} from "../src/testing/fakes.ts";

const CWD = "/repo/a";

/** Scope resolver that maps the cwd straight to a worktree root (no Git walk). */
function scopeAt(worktreeRoot?: string): FakeScopeResolver {
  return worktreeRoot === undefined
    ? new FakeScopeResolver()
    : new FakeScopeResolver({ workspaceId: "ws_1", worktreeRoot });
}

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function requiredFileContents(fs: FakeFileSystem, path: string): string {
  const file = fs.files.get(path);
  if (file === undefined) throw new Error(`expected file at ${path}`);
  return file.contents;
}

describe("initProject", () => {
  test("creates .asem.yaml with the workspace id when missing", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject(
      { fs, scopeResolver: scopeAt() },
      { cwd: CWD, workspaceId: "ws_42" },
    );

    const { configPath } = expectOk(result);
    expect(configPath).toBe("/repo/a/.asem.yaml");

    expect(requiredFileContents(fs, configPath)).toBe(
      [
        "workspace:",
        "  id: ws_42",
        "mux:",
        "  default: herdr",
        "agent:",
        "  default: claude",
        "",
      ].join("\n"),
    );
  });

  test("omits empty project-local template maps from generated .asem.yaml", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject(
      { fs, scopeResolver: scopeAt() },
      {
        cwd: CWD,
        workspaceId: "ws_42",
        agent: { default: "claude", templates: {} },
        mux: { default: "herdr", templates: {} },
      },
    );

    const { configPath } = expectOk(result);
    const config = requiredFileContents(fs, configPath);
    expect(config).not.toContain("templates: {}");
    expect(config).toContain("mux:\n  default: herdr\nagent:");
  });

  test("generated .asem.yaml omits empty collections instead of flow-style notation", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject(
      { fs, scopeResolver: scopeAt() },
      {
        cwd: CWD,
        workspaceId: "ws_42",
        agent: {
          default: "custom-agent",
          templates: {
            "custom-agent": { command: "agent", before_agent: [] },
            empty: {},
          },
        },
        mux: {
          default: "custom-mux",
          templates: {
            "custom-mux": {
              create: [],
              refs: {},
              send: [{ type: "run", command: "send {{message_shell}}" }],
            },
            empty: {},
          },
        },
      },
    );

    const { configPath } = expectOk(result);
    const config = requiredFileContents(fs, configPath);
    expect(config).not.toContain(": {}");
    expect(config).not.toContain("- {}");
    expect(config).not.toContain(": []");
    expect(config).not.toContain("- []");
    expect(config).not.toContain("empty:");
    expect(config).not.toContain("before_agent:");
    expect(config).not.toContain("create:");
    expect(config).not.toContain("refs:");
    expect(config).toContain("send:\n        - type: run");
  });

  test("creates .asem.yaml with selected agent and mux templates", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject(
      { fs, scopeResolver: scopeAt() },
      {
        cwd: CWD,
        workspaceId: "ws_42",
        agent: {
          default: "pi",
          templates: {
            pi: { command: "pi {{prompt_shell}}" },
          },
        },
        mux: {
          default: "tmux",
          templates: {
            tmux: {
              create: [
                {
                  type: "run",
                  command: "tmux new-window -n {{name_shell}}",
                  capture: [{ name: "pane_id", regex: "(.*)", group: 1 }],
                },
              ],
              run_in_pane: [
                {
                  type: "run",
                  command:
                    "tmux send-keys -t {{pane_id_shell}} {{launch_cmd_shell}} Enter",
                },
              ],
              send: [
                {
                  type: "run",
                  command:
                    "tmux send-keys -t {{pane_id_shell}} {{message_shell}} Enter",
                },
              ],
              attach: [{ type: "run", command: "tmux attach-session" }],
              close: [
                { type: "run", command: "tmux kill-pane -t {{pane_id_shell}}" },
              ],
            },
          },
        },
      },
    );

    const { configPath } = expectOk(result);
    const config = requiredFileContents(fs, configPath);
    expect(config).toContain("default: tmux");
    expect(config).toContain("default: pi");
    expect(config).toContain("templates:\n    tmux:");
    expect(config).toContain("templates:\n    pi:");
    expect(config).toContain(
      'command: "tmux send-keys -t {{pane_id_shell}} {{message_shell}} Enter"',
    );
    expect(config).toContain('command: "pi {{prompt_shell}}"');
  });

  test("adds all runtime ignore rules to a fresh .gitignore", async () => {
    const fs = new FakeFileSystem();
    await initProject(
      { fs, scopeResolver: scopeAt() },
      { cwd: CWD, workspaceId: "ws_1" },
    );

    const gitignore = fs.files.get("/repo/a/.gitignore");
    expect(gitignore).toBeDefined();
    for (const rule of RUNTIME_GITIGNORE_RULES) {
      expect(gitignore!.contents).toContain(rule);
    }
  });

  test("covers token-bearing paths in the ignore rules", () => {
    // Principle 8: token files and the current-session pointer stay out of Git.
    expect(RUNTIME_GITIGNORE_RULES).toContain(".asem/sessions/");
    expect(RUNTIME_GITIGNORE_RULES).toContain(".asem/current-session*.json");
    expect(RUNTIME_GITIGNORE_RULES).toContain(".asem/tokens/");
  });

  test("from a subdirectory: writes config + gitignore at the worktree root", async () => {
    // MIK-018: init must initialize the resolved Worktree Root, not the raw cwd.
    const fs = new FakeFileSystem();
    const worktreeRoot = "/repo/a";
    const result = await initProject(
      { fs, scopeResolver: scopeAt(worktreeRoot) },
      { cwd: "/repo/a/packages/deep/nested", workspaceId: "ws_1" },
    );

    const { configPath } = expectOk(result);
    // Both files land at the worktree root, not under the subdirectory.
    expect(configPath).toBe(configPathFor(worktreeRoot));
    expect(fs.files.has(configPathFor(worktreeRoot))).toBe(true);
    expect(fs.files.has(gitignorePathFor(worktreeRoot))).toBe(true);
    expect(fs.files.has("/repo/a/packages/deep/nested/.asem.yaml")).toBe(false);
    expect(fs.files.has("/repo/a/packages/deep/nested/.gitignore")).toBe(false);
  });

  test("from a subdirectory: generated rules cover the runtime token paths", async () => {
    // The same Worktree Root drives both init's ignore file and the later
    // Session-directory / token / current-session pointer writes, so a subdir
    // launch can never leave token-bearing state outside ignore coverage.
    const fs = new FakeFileSystem();
    const worktreeRoot = "/repo/a";
    await initProject(
      { fs, scopeResolver: scopeAt(worktreeRoot) },
      { cwd: "/repo/a/sub", workspaceId: "ws_1" },
    );

    const gitignore = fs.files.get(gitignorePathFor(worktreeRoot))!.contents;

    // Every runtime path is rooted at the worktree root and matched by a rule
    // relative to the .gitignore there.
    const runtimePaths = [
      { path: sessionDirFor(worktreeRoot, "s_0001"), rule: ".asem/sessions/" },
      { path: tokenFileFor(worktreeRoot, "s_0001"), rule: ".asem/tokens/" },
      {
        path: currentSessionFileFor(worktreeRoot),
        rule: ".asem/current-session*.json",
      },
    ];
    for (const { path, rule } of runtimePaths) {
      expect(path.startsWith(`${worktreeRoot}/`)).toBe(true);
      expect(RUNTIME_GITIGNORE_RULES).toContain(rule);
      expect(gitignore).toContain(rule);
    }
  });

  test("leaves an existing config untouched but still appends missing rules", async () => {
    const fs = new FakeFileSystem();
    fs.files.set("/repo/a/.asem.yaml", {
      contents: "workspace:\n  id: existing\n",
    });

    await initProject(
      { fs, scopeResolver: scopeAt() },
      { cwd: CWD, workspaceId: "ws_new" },
    );

    // Existing config is not rewritten.
    expect(fs.files.get("/repo/a/.asem.yaml")!.contents).toBe(
      "workspace:\n  id: existing\n",
    );
    // gitignore rules are still ensured.
    const gitignore = fs.files.get("/repo/a/.gitignore");
    expect(gitignore!.contents).toContain(".asem/tokens/");
  });

  test("preserves existing .gitignore content and appends only missing rules", async () => {
    const fs = new FakeFileSystem();
    fs.files.set("/repo/a/.gitignore", {
      contents: "node_modules/\n.asem/sessions/\n",
    });

    await initProject(
      { fs, scopeResolver: scopeAt() },
      { cwd: CWD, workspaceId: "ws_1" },
    );

    const gitignore = fs.files.get("/repo/a/.gitignore")!.contents;
    expect(gitignore).toContain("node_modules/");
    // Already-present rule is not duplicated.
    expect(gitignore.match(/\.asem\/sessions\//g)!.length).toBe(1);
    // Missing rules are added.
    expect(gitignore).toContain(".asem/tokens/");
    expect(gitignore).toContain(".asem/current-session*.json");
  });

  test("is idempotent: a second run rewrites nothing", async () => {
    const fs = new FakeFileSystem();
    await initProject(
      { fs, scopeResolver: scopeAt() },
      { cwd: CWD, workspaceId: "ws_1" },
    );
    const firstGitignore = fs.files.get("/repo/a/.gitignore")!.contents;

    const logger = new MemoryLogger();
    await initProject(
      { fs, scopeResolver: scopeAt(), logger },
      { cwd: CWD, workspaceId: "ws_1" },
    );

    // No write happened on the second run (config + gitignore already complete).
    expect(fs.files.get("/repo/a/.gitignore")!.contents).toBe(firstGitignore);
    expect(logger.entries).toHaveLength(0);
  });

  test("rejects invalid input with invalid_input", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject({ fs, scopeResolver: scopeAt() }, {
      cwd: "",
      workspaceId: "ws_1",
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });
});
