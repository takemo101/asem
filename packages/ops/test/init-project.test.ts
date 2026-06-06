import { describe, expect, test } from "bun:test";
import { initProject, RUNTIME_GITIGNORE_RULES } from "../src/index.ts";
import { FakeFileSystem, MemoryLogger } from "../src/testing/fakes.ts";

const CWD = "/repo/a";

function expectOk<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe("initProject", () => {
  test("creates .asem.yaml with the workspace id when missing", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject(
      { fs },
      { cwd: CWD, workspaceId: "ws_42" },
    );

    const { configPath } = expectOk(result);
    expect(configPath).toBe("/repo/a/.asem.yaml");

    const config = fs.files.get(configPath);
    expect(config).toBeDefined();
    expect(config!.contents).toContain("id: ws_42");
    expect(config!.contents).toContain("workspace:");
  });

  test("adds all runtime ignore rules to a fresh .gitignore", async () => {
    const fs = new FakeFileSystem();
    await initProject({ fs }, { cwd: CWD, workspaceId: "ws_1" });

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

  test("leaves an existing config untouched but still appends missing rules", async () => {
    const fs = new FakeFileSystem();
    fs.files.set("/repo/a/.asem.yaml", {
      contents: "workspace:\n  id: existing\n",
    });

    await initProject({ fs }, { cwd: CWD, workspaceId: "ws_new" });

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

    await initProject({ fs }, { cwd: CWD, workspaceId: "ws_1" });

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
    await initProject({ fs }, { cwd: CWD, workspaceId: "ws_1" });
    const firstGitignore = fs.files.get("/repo/a/.gitignore")!.contents;

    const logger = new MemoryLogger();
    await initProject({ fs, logger }, { cwd: CWD, workspaceId: "ws_1" });

    // No write happened on the second run (config + gitignore already complete).
    expect(fs.files.get("/repo/a/.gitignore")!.contents).toBe(firstGitignore);
    expect(logger.entries).toHaveLength(0);
  });

  test("rejects invalid input with invalid_input", async () => {
    const fs = new FakeFileSystem();
    const result = await initProject({ fs }, {
      cwd: "",
      workspaceId: "ws_1",
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
    }
  });
});
