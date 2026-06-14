import { describe, expect, test } from "bun:test";
import { parseProfileFile } from "../src/index.ts";
import { expectErr, expectOk, profileFile } from "./helpers.ts";

const PATH = "/repo/.asem/agents/reviewer.md";

describe("parseProfileFile", () => {
  test("parses required id and body with optional metadata", () => {
    const text = profileFile(
      {
        id: "reviewer",
        description: "Review code.",
        agent: "claude",
        model: "sonnet",
      },
      "You review changes.",
    );
    const profile = expectOk(parseProfileFile(text, "project", PATH));
    expect(profile).toEqual({
      id: "reviewer",
      source: "project",
      description: "Review code.",
      agent: "claude",
      model: "sonnet",
      instructions: "You review changes.",
    });
  });

  test("defaults optional metadata to null", () => {
    const profile = expectOk(
      parseProfileFile(profileFile({ id: "scout" }), "user", PATH),
    );
    expect(profile.description).toBeNull();
    expect(profile.agent).toBeNull();
    expect(profile.model).toBeNull();
    expect(profile.source).toBe("user");
  });

  test("rejects a missing id", () => {
    const text = profileFile({ description: "no id here" });
    expectErr(parseProfileFile(text, "project", PATH), "invalid_config");
  });

  test("rejects an empty body", () => {
    const text = "---\nid: scout\n---\n\n   \n";
    const error = expectErr(
      parseProfileFile(text, "project", PATH),
      "invalid_config",
    );
    expect(error.message).toContain("body");
  });

  test("rejects unknown frontmatter fields", () => {
    const text = profileFile({ id: "scout", role: "lead" });
    expectErr(parseProfileFile(text, "project", PATH), "invalid_config");
  });

  test("rejects missing frontmatter entirely", () => {
    expectErr(
      parseProfileFile("just a body, no frontmatter", "project", PATH),
      "invalid_config",
    );
  });

  test("rejects malformed YAML in the frontmatter block", () => {
    // A frontmatter block that delimits correctly but is not valid YAML
    // (unbalanced flow collection) must fail as invalid_config, not throw.
    const text = "---\nid: scout\nbad: [unterminated\n---\n\nbody\n";
    const error = expectErr(
      parseProfileFile(text, "project", PATH),
      "invalid_config",
    );
    expect(error.details?.path).toBe(PATH);
  });

  test("reports the offending path in details", () => {
    const error = expectErr(
      parseProfileFile("no frontmatter", "user", PATH),
      "invalid_config",
    );
    expect(error.details?.path).toBe(PATH);
  });
});
