import { describe, expect, test } from "bun:test";
import {
  BUILTIN_PROFILES,
  type ProfileDirs,
  resolveProfile,
  resolveProfiles,
} from "../src/index.ts";
import { expectErr, expectOk, FakeProfileFs, profileFile } from "./helpers.ts";

const DIRS: ProfileDirs = {
  projectDir: "/repo/.asem/agents",
  userDir: "/home/.asem/agents",
};

const BUILTIN_IDS = [
  "context-builder",
  "debugger",
  "delegate",
  "docs-writer",
  "oracle",
  "planner",
  "researcher",
  "reviewer",
  "scout",
  "worker",
];

const MAX_WORDS_PER_BUILTIN_PROFILE = 140;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const FORBIDDEN_BUILTIN_PROFILE_TERMS = [
  /\bcoordinator\b/i,
  /\bworker pool\b/i,
  /\btask lifecycle\b/i,
  /\bcompleted\/failed\/blocked\b/i,
  /\bauto[- ]?select/i,
  /\bscheduler\b/i,
  /\bsuccess\/failure\b/i,
];

describe("builtin profiles", () => {
  test("are exactly the ten instruction-only ids", () => {
    expect(BUILTIN_PROFILES.map((p) => p.id).sort()).toEqual(BUILTIN_IDS);
    for (const profile of BUILTIN_PROFILES) {
      expect(profile.source).toBe("builtin");
      expect(profile.agent).toBeNull();
      expect(profile.model).toBeNull();
      expect(profile.instructions).toContain("Mission:");
      expect(profile.instructions).toContain("Do:");
      expect(profile.instructions).toContain("Do not:");
      expect(profile.instructions).toContain("Output:");
    }
  });

  test("include pi-subagents-derived decision and research profiles", () => {
    const byId = new Map(BUILTIN_PROFILES.map((p) => [p.id, p]));
    expect(byId.get("oracle")?.instructions).toContain("decision-consistency");
    expect(byId.get("context-builder")?.instructions).toContain("handoff");
    expect(byId.get("researcher")?.instructions).toContain("sources");
    expect(byId.get("delegate")?.instructions).toContain("bounded task");
  });

  test("stay within the selected prompt budget", () => {
    for (const profile of BUILTIN_PROFILES) {
      expect(wordCount(profile.instructions), profile.id).toBeLessThanOrEqual(
        MAX_WORDS_PER_BUILTIN_PROFILE,
      );
    }
  });

  test("avoid workflow and lifecycle semantics", () => {
    for (const profile of BUILTIN_PROFILES) {
      for (const forbidden of FORBIDDEN_BUILTIN_PROFILE_TERMS) {
        expect(profile.instructions, profile.id).not.toMatch(forbidden);
      }
    }
  });
});

describe("resolveProfiles", () => {
  test("returns builtins sorted by id when no files exist", async () => {
    const all = expectOk(await resolveProfiles(new FakeProfileFs(), DIRS));
    expect(all.map((p) => p.id)).toEqual(BUILTIN_IDS);
  });

  test("user profiles replace builtins by whole-profile replacement", async () => {
    const fs = new FakeProfileFs().set(
      "/home/.asem/agents/reviewer.md",
      profileFile({ id: "reviewer", agent: "pi" }, "custom user reviewer"),
    );
    const all = expectOk(await resolveProfiles(fs, DIRS));
    const reviewer = all.find((p) => p.id === "reviewer");
    expect(reviewer?.source).toBe("user");
    expect(reviewer?.agent).toBe("pi");
    expect(reviewer?.instructions).toBe("custom user reviewer");
  });

  test("project profiles override user and builtin profiles", async () => {
    const fs = new FakeProfileFs()
      .set(
        "/home/.asem/agents/reviewer.md",
        profileFile({ id: "reviewer" }, "user reviewer"),
      )
      .set(
        "/repo/.asem/agents/reviewer.md",
        profileFile({ id: "reviewer" }, "project reviewer"),
      );
    const reviewer = expectOk(await resolveProfiles(fs, DIRS)).find(
      (p) => p.id === "reviewer",
    );
    expect(reviewer?.source).toBe("project");
    expect(reviewer?.instructions).toBe("project reviewer");
  });

  test("a new project id is added alongside builtins", async () => {
    const fs = new FakeProfileFs().set(
      "/repo/.asem/agents/migrator.md",
      profileFile({ id: "migrator" }, "migrate things"),
    );
    const all = expectOk(await resolveProfiles(fs, DIRS));
    expect(all.map((p) => p.id)).toContain("migrator");
    expect(all.length).toBe(BUILTIN_IDS.length + 1);
  });

  test("duplicate ids within one source fail with invalid_config and both paths", async () => {
    const fs = new FakeProfileFs()
      .set("/repo/.asem/agents/a.md", profileFile({ id: "dup" }, "first"))
      .set("/repo/.asem/agents/b.md", profileFile({ id: "dup" }, "second"));
    const error = expectErr(await resolveProfiles(fs, DIRS), "invalid_config");
    expect(error.details?.id).toBe("dup");
    expect(error.details?.paths).toEqual([
      "/repo/.asem/agents/a.md",
      "/repo/.asem/agents/b.md",
    ]);
  });

  test("a malformed file in a source fails with invalid_config", async () => {
    const fs = new FakeProfileFs().set(
      "/repo/.asem/agents/bad.md",
      "no frontmatter",
    );
    expectErr(await resolveProfiles(fs, DIRS), "invalid_config");
  });

  test("an unreadable existing profiles directory fails with invalid_config", async () => {
    const fs = new FakeProfileFs().failReadDir("/repo/.asem/agents");
    const error = expectErr(await resolveProfiles(fs, DIRS), "invalid_config");
    expect(error.details?.source).toBe("project");
    expect(error.details?.dir).toBe("/repo/.asem/agents");
  });

  test("an unreadable profile file fails with invalid_config and the path", async () => {
    const fs = new FakeProfileFs()
      .set(
        "/repo/.asem/agents/reviewer.md",
        profileFile({ id: "reviewer" }, "ok"),
      )
      .failReadFile("/repo/.asem/agents/reviewer.md");
    const error = expectErr(await resolveProfiles(fs, DIRS), "invalid_config");
    expect(error.details?.source).toBe("project");
    expect(error.details?.path).toBe("/repo/.asem/agents/reviewer.md");
  });

  test("the same id in different sources is not a duplicate conflict", async () => {
    const fs = new FakeProfileFs()
      .set(
        "/home/.asem/agents/reviewer.md",
        profileFile({ id: "reviewer" }, "user"),
      )
      .set(
        "/repo/.asem/agents/reviewer.md",
        profileFile({ id: "reviewer" }, "project"),
      );
    expectOk(await resolveProfiles(fs, DIRS));
  });
});

describe("resolveProfile", () => {
  test("returns a builtin by id", async () => {
    const profile = expectOk(
      await resolveProfile(new FakeProfileFs(), DIRS, "scout"),
    );
    expect(profile.id).toBe("scout");
    expect(profile.source).toBe("builtin");
  });

  test("an unknown id fails with invalid_input", async () => {
    const error = expectErr(
      await resolveProfile(new FakeProfileFs(), DIRS, "nope"),
      "invalid_input",
    );
    expect(error.details?.profile).toBe("nope");
  });

  test("propagates invalid_config from a malformed file", async () => {
    const fs = new FakeProfileFs().set(
      "/repo/.asem/agents/bad.md",
      "no frontmatter",
    );
    expectErr(await resolveProfile(fs, DIRS, "scout"), "invalid_config");
  });
});
