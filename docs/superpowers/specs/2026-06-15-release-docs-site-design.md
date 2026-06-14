# Release Documentation and Manual Site Design

## Goal

Prepare asem for public release by adding a product-oriented root `README.md` and a VitePress user manual at `https://takemo101.github.io/asem/`.

## Context

asem currently has durable internal documentation under `docs/`, including domain vocabulary, architecture notes, design documents, and ADRs. Those files are useful for maintainers and agents, but they are not shaped as a public user manual. The repository also does not currently have a root `README.md` or VitePress site.

mikan provides the reference pattern: a concise public README, a `site/` VitePress manual, `docs:*` package scripts, and internal docs kept separate from user-facing pages.

## Decisions

- The public manual uses VitePress under `site/`.
- The public URL is `https://takemo101.github.io/asem/`, so VitePress uses `base: "/asem/"`.
- Public docs are English-first.
- Installation examples use the release package name `@takemo101/asem`.
- The public manual is user-centered. Internal design, architecture, and ADR documents remain under `docs/` and are linked from a developer-docs page instead of being merged into the main sidebar as primary user content.
- This slice does not add GitHub Actions or publish workflow automation.
- This slice does not change CLI behavior or release package metadata beyond documentation scripts and the VitePress dev dependency.

## User-Facing Information Architecture

### Root README

Create `README.md` as the project landing page for GitHub and npm readers.

The README should include:

1. Product headline and one-paragraph explanation.
2. Manual link: `https://takemo101.github.io/asem/`.
3. Why use asem.
4. Install commands:
   - `npm install -g @takemo101/asem`
   - `npx @takemo101/asem init`
   - `bunx @takemo101/asem init`
5. Quickstart showing the smallest useful local flow:
   - `asem init --interactive`
   - `asem doctor`
   - `asem session create ...`
   - `asem message list` or `asem message wait`
   - `asem tui`
6. Core concepts: Session, Message, Report, Workspace, Worktree Root, Effective Scope, Multiplexer, Agent Template, Agent Profile, Integration Target.
7. Short feature sections for CLI, TUI Cockpit, Agent Profiles, MCP server, Integration Target setup, and configuration.
8. Development links to `docs/README.md`, `CONTEXT.md`, architecture docs, and ADRs.

The README should stay concise. Detailed command matrices and explanations belong in the manual.

### VitePress manual

Create these files:

- `site/index.md` — VitePress home page with hero and feature cards.
- `site/install.md` — install and one-off usage.
- `site/quickstart.md` — first project setup and first child Session.
- `site/concepts.md` — precise domain vocabulary for users.
- `site/cli.md` — command groups and common examples.
- `site/tui.md` — Cockpit purpose and key interactions.
- `site/agent-profiles.md` — builtin/project/user Agent Profiles and `--profile` use.
- `site/mcp-and-skills.md` — stdio MCP, `asem mcp add --for`, and `asem skills add --for`.
- `site/config.md` — `.asem.yaml` overview, templates, generated config shape, and workspace scope.
- `site/developer-docs.md` — links to internal durable docs.
- `site/.vitepress/config.ts` — VitePress config.

The VitePress config should follow mikan's shape:

- `title: "asem"`
- `description: "Local agent Session manager"`
- `lang: "en-US"`
- `base: "/asem/"`
- `lastUpdated: true`
- `cleanUrls: true`
- `srcDir: "."`
- `outDir: ".vitepress/dist"`
- `cacheDir: ".vitepress/cache"`
- local search enabled
- GitHub social link
- edit links pointing to `site/:path`

Sidebar groups:

1. Getting Started: Quickstart, Install, Concepts.
2. Usage: CLI, TUI, Agent Profiles, Config.
3. Agent Integration: MCP & Skills.
4. Project: Developer Docs.

## Package Scripts and Dependencies

Modify root `package.json`:

- Add `docs:dev`: `vitepress dev site`.
- Add `docs:build`: `vitepress build site`.
- Add `docs:preview`: `vitepress preview site`.
- Add dev dependency `vitepress` matching mikan's version unless dependency constraints require a newer compatible version.

## Boundaries

This work must not:

- add workflow-engine, task lifecycle, team, scheduler, or result semantics;
- expose Integration Target setup through `@asem/mcp` tools;
- change runtime command templates, store schema, Session semantics, or CLI parser behavior;
- make `.mcp.json` or `opencode.json` tracked release artifacts;
- publish generated VitePress output under `site/.vitepress/dist`.

## Validation

Required checks:

1. `bun run docs:build`
2. `bun test packages/cli/test/docs-links.test.ts`
3. `bun run check`

If dependency installation or lockfile changes are required for VitePress, update `bun.lock` in the same implementation PR. If any check fails for an existing unrelated issue, capture the exact command and failure, then stop for review.

## Release Readiness Criteria

- A new visitor can understand what asem does from the README without reading internal design docs.
- A new user can install, initialize, create a child Session, inspect Messages, and open the TUI using the manual.
- Agent Profile and Integration Target setup are discoverable from both README and manual.
- Existing durable docs remain linked for contributors and agents.
- The VitePress site builds successfully with the configured `/asem/` base.
