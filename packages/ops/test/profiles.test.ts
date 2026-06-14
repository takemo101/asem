import { describe, expect, test } from "bun:test";
import { getProfile, listProfiles } from "../src/index.ts";
import { FakeFileSystem, makeOpsDeps } from "../src/testing/fakes.ts";
import { expectErr, expectOk, scopeA } from "./helpers.ts";

const CTX = { cwd: scopeA.worktreeRoot };
const PROJECT_AGENTS = `${scopeA.worktreeRoot}/.asem/agents`;

function profileFile(
  frontmatter: Record<string, string>,
  body = "Profile instructions.",
): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

function depsWithProfiles(seed: Record<string, string> = {}) {
  const fs = new FakeFileSystem();
  for (const [name, contents] of Object.entries(seed)) {
    fs.dirs.add(PROJECT_AGENTS);
    fs.files.set(`${PROJECT_AGENTS}/${name}`, { contents });
  }
  return { ...makeOpsDeps({ fs }), fs };
}

describe("listProfiles", () => {
  test("returns the builtin profiles sorted by id when no files exist", async () => {
    const d = depsWithProfiles();
    const { profiles } = expectOk(await listProfiles(d, {}, CTX));
    expect(profiles.map((p) => p.id)).toEqual([
      "debugger",
      "docs-writer",
      "planner",
      "reviewer",
      "scout",
      "worker",
    ]);
  });

  test("includes project profiles and applies precedence", async () => {
    const d = depsWithProfiles({
      "reviewer.md": profileFile({ id: "reviewer" }, "project reviewer"),
      "migrator.md": profileFile({ id: "migrator" }, "migrate"),
    });
    const { profiles } = expectOk(await listProfiles(d, {}, CTX));
    const reviewer = profiles.find((p) => p.id === "reviewer");
    expect(reviewer?.source).toBe("project");
    expect(profiles.map((p) => p.id)).toContain("migrator");
  });

  test("surfaces invalid_config for a malformed profile file", async () => {
    const d = depsWithProfiles({ "bad.md": "no frontmatter" });
    expectErr(await listProfiles(d, {}, CTX), "invalid_config");
  });

  test("surfaces config_not_found when no .asem.yaml is discovered", async () => {
    const d = depsWithProfiles();
    const result = await listProfiles(
      {
        ...d,
        configLoader: {
          async load() {
            return { kind: "not_found" };
          },
        },
      },
      {},
      CTX,
    );
    expectErr(result, "config_not_found");
  });
});

describe("getProfile", () => {
  test("returns a builtin with full instructions", async () => {
    const d = depsWithProfiles();
    const { profile } = expectOk(await getProfile(d, { id: "scout" }, CTX));
    expect(profile.id).toBe("scout");
    expect(profile.source).toBe("builtin");
    expect(profile.instructions.length).toBeGreaterThan(0);
  });

  test("an unknown id fails with invalid_input", async () => {
    const d = depsWithProfiles();
    expectErr(await getProfile(d, { id: "nope" }, CTX), "invalid_input");
  });

  test("returns a project profile by id", async () => {
    const d = depsWithProfiles({
      "reviewer.md": profileFile(
        { id: "reviewer", agent: "claude" },
        "project reviewer",
      ),
    });
    const { profile } = expectOk(await getProfile(d, { id: "reviewer" }, CTX));
    expect(profile.source).toBe("project");
    expect(profile.agent).toBe("claude");
    expect(profile.instructions).toBe("project reviewer");
  });
});
