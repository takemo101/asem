import { describe, expect, test } from "bun:test";
import { renderProfilePrompt } from "../src/index.ts";

describe("renderProfilePrompt", () => {
  const profile = {
    id: "reviewer",
    source: "project" as const,
    instructions: "You review changes.\nReport blockers first.",
  };

  test("renders profile instructions first, then the user prompt", () => {
    const rendered = renderProfilePrompt(profile, "Review the current diff");
    expect(rendered).toBe(
      [
        "# Agent Profile",
        "",
        "Profile: reviewer",
        "Source: project",
        "",
        "You review changes.\nReport blockers first.",
        "",
        "# User Prompt",
        "",
        "Review the current diff",
      ].join("\n"),
    );
  });

  test("preserves the original user prompt exactly under # User Prompt", () => {
    const userPrompt = "Multi\nline\n  prompt with trailing spaces   ";
    const rendered = renderProfilePrompt(profile, userPrompt);
    const marker = "# User Prompt\n\n";
    const tail = rendered.slice(rendered.indexOf(marker) + marker.length);
    expect(tail).toBe(userPrompt);
  });
});
