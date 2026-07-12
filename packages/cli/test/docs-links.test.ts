/**
 * Docs link / placeholder scan (MIK-014 test guidance).
 *
 * A lightweight guard that keeps the durable docs honest as the MVP is finalized:
 * every relative Markdown link in the durable docs must resolve to a real file or
 * directory, and no leftover placeholder markers (FIXME / TKTK / lorem ipsum)
 * should ship. It reads only repo Markdown — no network, no real services — so it
 * runs in the default suite. External `http(s)` links and pure `#anchor` links are
 * intentionally out of scope.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// packages/cli/test → repo root.
const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

/**
 * The durable Markdown surface this scan owns. `site/` is excluded because its
 * VitePress pages use site-absolute route links (`/quickstart`), not relative
 * file links; `bun run docs:build` validates those.
 */
const ROOTS = ["docs", "AGENTS.md", "CONTEXT.md", "README.md"];

const PLACEHOLDER_MARKERS = ["FIXME", "TKTK", "lorem ipsum"];

function markdownFiles(): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    const abs = join(REPO_ROOT, rel);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(abs)) visit(join(rel, entry));
      return;
    }
    if (rel.endsWith(".md")) out.push(rel);
  };
  for (const root of ROOTS) visit(root);
  return out;
}

/** Relative Markdown link targets in `contents` (skips images, http, anchors). */
function relativeLinks(contents: string): string[] {
  const targets: string[] = [];
  const linkRe = /(!?)\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of contents.matchAll(linkRe)) {
    const target = match[2]!.trim().split(/\s+/)[0]!; // drop any "title"
    if (target.startsWith("#")) continue;
    if (/^[a-z]+:\/\//.test(target)) continue;
    if (target.startsWith("mailto:")) continue;
    targets.push(target.split("#")[0]!); // strip any trailing anchor
  }
  return targets.filter((t) => t.length > 0);
}

describe("durable docs", () => {
  const files = markdownFiles();

  test("scan covers the durable docs surface", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("AGENTS.md");
    expect(files).toContain("CONTEXT.md");
  });

  test("every relative Markdown link resolves to a real path", () => {
    const broken: string[] = [];
    for (const rel of files) {
      const contents = readFileSync(join(REPO_ROOT, rel), "utf8");
      for (const target of relativeLinks(contents)) {
        const resolved = resolve(dirname(join(REPO_ROOT, rel)), target);
        try {
          statSync(resolved);
        } catch {
          broken.push(`${rel} → ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test("site MCP page gives integration-client wait deadline guidance", () => {
    const contents = readFileSync(
      join(REPO_ROOT, "site", "mcp-and-skills.md"),
      "utf8",
    );
    expect(contents).toContain(
      "client tool-call deadline strictly longer than the requested `timeoutMs`",
    );
    expect(contents).toContain("(default 30s, max 60s)");
    expect(contents).toContain("successful empty page with `timedOut: true`");
  });

  test("site config guide uses the current configuration keys and workspace examples", () => {
    const contents = readFileSync(join(REPO_ROOT, "site", "config.md"), "utf8");

    expect(contents).toContain("workspace:\n  id: acme");
    expect(contents).toContain("agent:\n  default: pi");
    expect(contents).toContain("mux:\n  default: herdr");
    expect(contents).toContain("repos:\n  frontend:\n    path: apps/frontend");
    expect(contents).toContain("`asem workspace repo list`");
    expect(contents).toContain("multiple Worktree Roots");
    expect(contents).not.toMatch(/^defaults:/m);
  });

  test("no leftover placeholder markers", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const contents = readFileSync(join(REPO_ROOT, rel), "utf8").toLowerCase();
      for (const marker of PLACEHOLDER_MARKERS) {
        if (contents.includes(marker.toLowerCase())) {
          offenders.push(`${rel}: ${marker}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
