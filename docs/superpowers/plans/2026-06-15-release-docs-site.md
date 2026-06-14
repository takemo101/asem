# Release Docs Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public release README and VitePress user manual for asem at `https://takemo101.github.io/asem/`.

**Architecture:** Keep public user documentation in `README.md` and `site/`, while existing `docs/` stays the durable developer/agent design surface. The VitePress site mirrors mikan's structure with `/asem/` base, local search, and user-centered pages. Root package scripts build and preview the site without changing CLI/runtime behavior.

**Tech Stack:** Markdown, VitePress 1.6.4, Bun package scripts, Biome formatting, existing Bun test suite, GitButler CLI.

---

## File Structure

- Create `README.md`: concise public project landing page for GitHub/npm readers.
- Create `site/.vitepress/config.ts`: VitePress config with `/asem/` base, nav/sidebar, local search, edit links, and GitHub link.
- Create `site/index.md`: VitePress home page with hero and feature cards.
- Create `site/install.md`: install, one-off use, prerequisites, and doctor check.
- Create `site/quickstart.md`: initialize a Workspace and create/use a child Session.
- Create `site/concepts.md`: user-level vocabulary and boundaries.
- Create `site/cli.md`: command group reference and common examples.
- Create `site/tui.md`: Cockpit overview and keyboard usage.
- Create `site/agent-profiles.md`: builtin/project/user Agent Profiles and `--profile` usage.
- Create `site/mcp-and-skills.md`: stdio MCP server plus Integration Target MCP/Skill setup.
- Create `site/config.md`: `.asem.yaml`, templates, scope, runtime files, and generated config guidance.
- Create `site/developer-docs.md`: links to repository developer docs on GitHub so VitePress does not need to resolve pages outside `site/`.
- Modify `package.json`: add docs scripts and VitePress dev dependency.
- Modify `bun.lock`: update through `bun install` after adding VitePress.

---

### Task 1: Add root release README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md` with this structure and content:

```md
# asem

asem is a local agent Session manager for AI-assisted development. It helps a human or parent agent create child Sessions, exchange Messages, collect Reports, and inspect local work from a CLI, TUI Cockpit, or stdio MCP server.

Manual: <https://takemo101.github.io/asem/>

## Why use asem?

AI coding sessions often need more structure than a terminal tab, but less process than a task scheduler or workflow engine. asem is meant for that middle ground:

- launch and track local child Sessions from one project Workspace;
- keep Message and Report history scoped to the current Workspace and Worktree Root;
- use familiar multiplexers such as tmux, zellij, herdr, or rmux through Templates;
- shape child prompts with explicit Agent Profiles;
- let compatible AI clients connect through stdio MCP and installed Skills.

asem is intentionally small. It is not a task board, team scheduler, hosted service, workflow engine, or result evaluator.

## Install

```sh
npm install -g @takemo101/asem
```

One-off use:

```sh
npx @takemo101/asem init
# or
bunx @takemo101/asem init
```

asem is currently built for Bun-based execution. The published package installs an `asem` binary backed by the bundled CLI entrypoint.

## Quickstart

```sh
cd /path/to/your/repo
asem init --interactive
asem doctor
asem session create reviewer-1 --prompt "Review the current diff" --profile reviewer
asem message list
asem tui
```

`asem init --interactive` creates `.asem.yaml` for the current Worktree Root. `asem doctor` checks that builtin Agent and Multiplexer commands are available. `session create` launches a child Session and stores its Message history in local asem state.

## Core concepts

- **Session**: a registered agent process or child process that can receive Messages and produce Reports.
- **Message**: durable local communication addressed to a Session.
- **Report**: a child Session's summary sent to its parent Session.
- **Workspace**: logical project scope shared by related Sessions.
- **Worktree Root**: filesystem root that participates in scope isolation.
- **Effective Scope**: `workspace_id + worktree_root`, the normal boundary for visibility and messaging.
- **Multiplexer**: the terminal host used to launch or attach to a Session pane.
- **Agent Template**: command template for launching a CLI agent.
- **Agent Profile**: explicit prompt-shaping instructions and optional launch defaults.
- **Integration Target**: an external AI client whose local MCP or Skill config can be updated.

See [Concepts](https://takemo101.github.io/asem/concepts) for details.

## CLI

The CLI exposes primitive Session and Message operations:

```sh
asem session list
asem session get <id>
asem message send <session-id> --body "status?"
asem message wait
asem report parent --body "Review complete"
```

Run `asem --help` or `asem <command> --help` for focused help.

## TUI Cockpit

```sh
asem tui
```

The Cockpit is a keyboard-first local view of Sessions, Messages, and details in the Effective Scope. It is a human surface only; operation semantics live in shared ops code.

## Agent Profiles

Use Profiles to shape child Session prompts without inventing roles or workflow state:

```sh
asem profile list
asem session create reviewer-1 --profile reviewer --prompt "Review this branch"
```

Builtin Profiles include `worker`, `reviewer`, `planner`, `debugger`, `researcher`, and other focused prompt-shaping options.

## MCP and Skills

Start the stdio MCP server:

```sh
asem mcp
```

Register it with a supported Integration Target:

```sh
asem mcp add --for claude-code
asem mcp add --for opencode --no-global
```

Install agent guidance separately:

```sh
asem skills add --for pi
asem skills add --for copilot-cli
```

MCP registration and Skill installation are independent. Setup commands edit local Integration Target config files; they are not exposed through the asem MCP server.

## Configuration

`asem init --interactive` writes `.asem.yaml`. The config selects default Workspace, Agent Template, Multiplexer Template, and optional Template settings. Runtime state and token-bearing files live under ignored `.asem/` paths.

## Development docs

Public user docs live in the manual. Durable design and maintainer docs live in this repository:

- Documentation map: `./docs/README.md`
- Domain vocabulary: `./CONTEXT.md`
- Architecture overview: `./docs/architecture/overview.md`
- Design docs: `./docs/designs/README.md`
- ADRs: `./docs/adr/README.md`
```

- [ ] **Step 2: Check local Markdown links in README manually**

Run:

```sh
bun test packages/cli/test/docs-links.test.ts
```

Expected: the existing docs link scan passes. The scan does not include root `README.md`, so also inspect the local README links in the previous step: `./docs/README.md`, `./CONTEXT.md`, `./docs/architecture/overview.md`, `./docs/designs/README.md`, and `./docs/adr/README.md` all exist.

- [ ] **Step 3: Commit README**

Run:

```sh
but status -fv
but commit release-docs-site -m "Add release README" --changes <README_CHANGE_ID>
```

Expected: GitButler creates a commit on `release-docs-site` containing only `README.md`.

---

### Task 2: Add VitePress configuration and package scripts

**Files:**
- Create: `site/.vitepress/config.ts`
- Modify: `package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add VitePress config**

Create `site/.vitepress/config.ts`:

```ts
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "asem",
  description: "Local agent Session manager",
  lang: "en-US",
  base: "/asem/",
  lastUpdated: true,
  cleanUrls: true,
  srcDir: ".",
  outDir: ".vitepress/dist",
  cacheDir: ".vitepress/cache",
  head: [["meta", { name: "theme-color", content: "#2563eb" }]],
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "Install", link: "/install" },
      { text: "Concepts", link: "/concepts" },
      { text: "CLI", link: "/cli" },
      { text: "TUI", link: "/tui" },
      { text: "MCP & Skills", link: "/mcp-and-skills" },
      { text: "GitHub", link: "https://github.com/takemo101/asem" },
    ],
    sidebar: {
      "/": [
        {
          text: "Getting Started",
          items: [
            { text: "Quickstart", link: "/quickstart" },
            { text: "Install", link: "/install" },
            { text: "Concepts", link: "/concepts" },
          ],
        },
        {
          text: "Usage",
          items: [
            { text: "CLI", link: "/cli" },
            { text: "TUI", link: "/tui" },
            { text: "Agent Profiles", link: "/agent-profiles" },
            { text: "Config", link: "/config" },
          ],
        },
        {
          text: "Agent Integration",
          items: [{ text: "MCP & Skills", link: "/mcp-and-skills" }],
        },
        {
          text: "Project",
          items: [{ text: "Developer Docs", link: "/developer-docs" }],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/takemo101/asem" },
    ],
    editLink: {
      pattern: "https://github.com/takemo101/asem/edit/main/site/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 takemo101",
    },
    search: { provider: "local" },
  },
});
```

- [ ] **Step 2: Add docs scripts and VitePress dependency**

Modify `package.json` so scripts include:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "bun test",
    "lint": "biome check .",
    "fix": "biome check --write .",
    "check": "bun run lint && bun run typecheck && bun run test",
    "docs:dev": "vitepress dev site",
    "docs:build": "vitepress build site",
    "docs:preview": "vitepress preview site",
    "prepare": "lefthook install"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/bun": "latest",
    "lefthook": "^1.7.0",
    "typescript": "^5.6.0",
    "vitepress": "1.6.4"
  }
}
```

Keep the existing `name`, `version`, `private`, `type`, `description`, and `workspaces` fields unchanged.

- [ ] **Step 3: Update lockfile**

Run:

```sh
bun install
```

Expected: `bun.lock` updates to include VitePress and dependencies. If `bun install` changes unrelated package versions, inspect the diff and keep only normal lockfile changes caused by adding VitePress.

- [ ] **Step 4: Format config and package JSON**

Run:

```sh
bunx biome format --write package.json site/.vitepress/config.ts
```

Expected: both files are formatted with two-space indentation.

- [ ] **Step 5: Build should still fail until pages exist**

Run:

```sh
bun run docs:build
```

Expected: it may fail because content pages are not created yet. Record the failure only if it is unrelated to missing pages. Do not commit a failing final state.

- [ ] **Step 6: Commit config and dependency setup**

Run:

```sh
but status -fv
but commit release-docs-site -m "Configure VitePress manual site" --changes <CONFIG_ID>,<PACKAGE_JSON_ID>,<LOCKFILE_ID>
```

Expected: GitButler creates a commit containing `site/.vitepress/config.ts`, `package.json`, and `bun.lock`.

---

### Task 3: Add Getting Started manual pages

**Files:**
- Create: `site/index.md`
- Create: `site/install.md`
- Create: `site/quickstart.md`
- Create: `site/concepts.md`

- [ ] **Step 1: Create home page**

Create `site/index.md`:

```md
---
layout: home

hero:
  name: asem
  text: Local agent Session manager
  tagline: Create child Sessions, exchange Messages, collect Reports, and inspect local agent work without turning your project into a workflow engine.
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart
    - theme: alt
      text: Install
      link: /install
    - theme: alt
      text: View on GitHub
      link: https://github.com/takemo101/asem

features:
  - icon: 🧭
    title: Scoped local Sessions
    details: Sessions are visible in the Effective Scope: Workspace plus Worktree Root. Local state stays tied to the project you are working in.
  - icon: 💬
    title: Messages and Reports
    details: Send durable Messages to child Sessions and collect Reports back from them. Pane delivery is best-effort; local store rows are the durable truth.
  - icon: 🖥️
    title: Multiplexer-backed launch
    details: Launch or attach through Templates for tmux, zellij, herdr, rmux, or other local multiplexers without hard-coding one terminal model.
  - icon: 🧑‍💻
    title: Agent Profiles
    details: Shape prompts with explicit Profiles such as reviewer, worker, planner, debugger, and researcher. Profiles do not create roles or workflow state.
  - icon: 🔌
    title: Stdio MCP for agents
    details: Expose primitive Session and Message operations through a stdio MCP server for compatible AI clients.
  - icon: 🧩
    title: Integration Target setup
    details: Register MCP and install Skill guidance for supported AI clients through CLI-only setup commands.
---
```

- [ ] **Step 2: Create install page**

Create `site/install.md`:

```md
# Install

Install the release package globally:

```sh
npm install -g @takemo101/asem
```

One-off use:

```sh
npx @takemo101/asem init
# or
bunx @takemo101/asem init
```

The installed binary is `asem`.

## Runtime expectations

asem is currently built for Bun-based execution. The published package installs a bundled CLI entrypoint, but development and tests use Bun directly.

Useful local tools depend on the Templates you choose:

- Agent CLIs such as `pi`, `claude`, `codex`, `opencode`, or compatible commands.
- Multiplexers such as `tmux`, `zellij`, `herdr`, or `rmux`.

Run diagnostics after installation:

```sh
asem doctor
```

`asem doctor` checks builtin Agent and Multiplexer command availability. Missing commands are diagnostics, not command failures.

## Initialize a project

```sh
cd /path/to/your/repo
asem init --interactive
```

This writes `.asem.yaml` for the current Worktree Root. Re-running init on an existing config leaves it unchanged.

## Next

Continue with the Quickstart page at `/quickstart`.
```

- [ ] **Step 3: Create quickstart page**

Create `site/quickstart.md`:

```md
# Quickstart

Create and inspect a local child Session in one project.

## 1. Initialize the Worktree Root

```sh
cd /path/to/your/repo
asem init --interactive
```

The Init Wizard asks for a Workspace id, default Agent Template, and default Multiplexer Template. It writes `.asem.yaml`.

## 2. Check local commands

```sh
asem doctor
```

Doctor prints command availability for builtin Agent and Multiplexer Templates.

## 3. Create a child Session

```sh
asem session create reviewer-1 --profile reviewer --prompt "Review the current diff"
```

The child Session is launched through the selected Multiplexer Template. The prompt is written to that Session's launch files, and local Session metadata is stored in asem state.

If the selected Agent Template supports models, pass one explicitly:

```sh
asem session create reviewer-2 --profile reviewer --model sonnet --prompt "Review the current diff"
```

## 4. Inspect Sessions and Messages

```sh
asem session list
asem message list
```

Messages and Reports are scoped by Workspace and Worktree Root.

## 5. Open the Cockpit

```sh
asem tui
```

The Cockpit provides a keyboard-first view of local Sessions and details.

## 6. Register an AI client when needed

```sh
asem mcp add --for claude-code
asem skills add --for claude-code
```

MCP registration and Skill installation are separate. They update the selected Integration Target's local config and guidance files.

## What just happened

- `.asem.yaml` defined project defaults.
- A child Session was created with explicit prompt shaping.
- Session and Message history stayed local to the Effective Scope.
- The TUI and MCP server can operate over the same local state.
```

- [ ] **Step 4: Create concepts page**

Create `site/concepts.md`:

```md
# Concepts

asem uses a small vocabulary. These words describe local runtime state, not project-management workflow.

## Session

A Session is a registered agent process or launched child process. It has local metadata, a Multiplexer reference, and Message history.

Session status is process or connection state only. It is not work outcome. A closed Session is not a failed task; it is just no longer live.

## Message

A Message is durable local communication addressed to a Session. The local store row is the source of truth. Multiplexer pane delivery is best-effort notification/input.

## Report

A Report is a child Session's summary sent to its parent Session. Reports are Messages with parent-oriented semantics.

## Workspace

A Workspace is a logical project id. It lets related Worktree Roots share a project identity without requiring remote tenancy.

## Worktree Root

The Worktree Root is the filesystem root for the current checkout. asem uses it with Workspace to isolate normal visibility.

## Effective Scope

The Effective Scope is `workspace_id + worktree_root`. Normal Session visibility and messaging are scoped by this pair.

## Multiplexer

A Multiplexer hosts Session panes or processes. Builtin Templates can target tools such as tmux, zellij, herdr, and rmux.

## Agent Template

An Agent Template defines the command sequence for launching an AI client. It may support a model shell fragment through `{{model_shell}}`.

## Agent Profile

An Agent Profile is explicit prompt shaping plus optional launch defaults. Profiles are not roles, teams, workflow states, or result evaluators.

## Integration Target

An Integration Target is an external AI client or tool whose local config can be updated by `asem mcp add --for` or `asem skills add --for`.

Integration Targets are not Session Agents. Setup commands are CLI-only and are not exposed through the asem MCP server.

## What asem is not

asem is not a task board, scheduler, swarm runtime, hosted service, branch manager, or success/failure interpreter. Use it to manage local agent Sessions and communication, not to model project workflow.
```

- [ ] **Step 5: Run a partial docs build**

Run:

```sh
bun run docs:build
```

Expected: it may still fail because sidebar pages from later tasks are missing. Any TypeScript/config error must be fixed before continuing.

- [ ] **Step 6: Commit Getting Started pages**

Run:

```sh
but status -fv
but commit release-docs-site -m "Add getting started manual pages" --changes <INDEX_ID>,<INSTALL_ID>,<QUICKSTART_ID>,<CONCEPTS_ID>
```

Expected: GitButler creates a commit containing the four new manual pages.

---

### Task 4: Add Usage manual pages

**Files:**
- Create: `site/cli.md`
- Create: `site/tui.md`
- Create: `site/agent-profiles.md`
- Create: `site/config.md`

- [ ] **Step 1: Create CLI page**

Create `site/cli.md`:

```md
# CLI

The `asem` CLI exposes small primitive operations. Run focused help for exact options:

```sh
asem --help
asem session create --help
asem message send --help
```

## Setup

```sh
asem init --interactive
asem init --workspace acme --agent pi --mux tmux
asem doctor
```

`init` writes `.asem.yaml`. `doctor` checks builtin command availability without opening or migrating runtime state.

## Sessions

```sh
asem session create reviewer-1 --profile reviewer --prompt "Review this branch"
asem session list
asem session get <session-id>
asem session attach <session-id>
asem session close <session-id>
asem session delete <session-id>
```

`delete` is destructive and refuses to remove a live Session. Close live Sessions first.

## Profiles

```sh
asem profile list
asem profile get reviewer
```

Profiles resolve project, then user, then builtin. A project or user Profile replaces a builtin Profile of the same id.

## Messages and Reports

```sh
asem message list
asem message send <session-id> --body "status?"
asem message wait
asem report parent --body "Review complete"
```

`report parent` sends a Report to the current Session's parent Session.

## Surfaces

```sh
asem tui
asem mcp
```

`tui` opens the human Cockpit. `mcp` starts the stdio MCP server.

## Integration setup

```sh
asem mcp add --for claude-code
asem mcp add --for opencode --no-global
asem skills add --for pi
asem skills add --for copilot-cli
```

`--no-global` requests workspace-local configuration when the Integration Target supports it. Unsupported scopes fail clearly.
```

- [ ] **Step 2: Create TUI page**

Create `site/tui.md`:

```md
# TUI Cockpit

Open the Cockpit:

```sh
asem tui
```

The Cockpit is the human terminal surface for local Sessions in the Effective Scope. It projects shared operation semantics; it does not duplicate Session lifecycle logic.

## What it shows

- Session list and selected Session details.
- Message and Report activity.
- Attach, close, delete, and refresh actions where available.
- Toast-style notices for operation results.

## Scope

The TUI defaults to workspace-live inspection. It does not infer task outcome from Session status. Closed means the process or pane is closed, not that the child succeeded or failed.

## Attach and close

Attaching is a human-only Multiplexer action. Closing uses the shared `close_session` operation and respects borrowed Multiplexer ownership.

## When to use the CLI instead

Use CLI commands when you need scriptable output, JSON output, MCP server startup, or Integration Target setup.
```

- [ ] **Step 3: Create Agent Profiles page**

Create `site/agent-profiles.md`:

```md
# Agent Profiles

Agent Profiles shape child Session prompts and can provide optional launch defaults.

```sh
asem profile list
asem profile get reviewer
asem session create reviewer-1 --profile reviewer --prompt "Review the diff"
```

## What a Profile can do

A Profile can:

- add instructions before the user prompt;
- set a default Agent Template;
- set a default model when the selected Agent Template supports models.

Explicit CLI flags win over Profile defaults.

## What a Profile cannot do

A Profile does not create a role, team, workflow state, scheduler, success criteria engine, or result evaluator.

## Builtin Profiles

Builtin Profiles include:

- `context-builder`
- `debugger`
- `delegate`
- `docs-writer`
- `oracle`
- `planner`
- `researcher`
- `reviewer`
- `scout`
- `worker`

## Project and user Profiles

Project Profiles live under `.asem/agents/*.md`. User Profiles can be installed in the user-level Profile directory. Resolution order is project, user, then builtin. A higher-priority Profile replaces a lower-priority Profile with the same id.

## Prompt order

When `--profile` is used, profile instructions come first and the user's prompt comes second. This keeps the requested task visible while making the Profile's operating guidance explicit.
```

- [ ] **Step 4: Create config page**

Create `site/config.md`:

```md
# Config

`asem init --interactive` creates `.asem.yaml` in the Worktree Root.

## Generated config

A minimal config records the Workspace and default Templates. Generated config omits empty schema-default fields and avoids JSON-like flow-style empty collections.

```yaml
workspace:
  id: acme

defaults:
  agent: pi
  mux: tmux
```

Exact fields can grow as Templates and local defaults are configured.

## Workspace and Worktree Root

Normal visibility and messaging use the Effective Scope: Workspace id plus Worktree Root. This keeps local Sessions from different checkouts separate even when they share a Workspace name.

## Templates

Agent Templates define command sequences for AI clients. Multiplexer Templates define how a child Session is hosted and attached. Template command sequences are runtime configuration, not workflow definitions.

## Runtime state

Token-bearing runtime files are ignored and should not be committed:

```txt
.asem/sessions/
.asem/current-session*.json
.asem/tokens/
```

Store only token hashes in SQLite. Avoid putting raw tokens in command-line arguments, pane labels, logs, or structured errors.

## Integration Target config

`asem mcp add --for` and `asem skills add --for` update the selected external AI client's config or Skill directory. Those target files are separate from `.asem.yaml`.
```

- [ ] **Step 5: Commit Usage pages**

Run:

```sh
but status -fv
but commit release-docs-site -m "Add usage manual pages" --changes <CLI_ID>,<TUI_ID>,<PROFILES_ID>,<CONFIG_ID>
```

Expected: GitButler creates a commit containing the four Usage pages.

---

### Task 5: Add integration and developer pages

**Files:**
- Create: `site/mcp-and-skills.md`
- Create: `site/developer-docs.md`

- [ ] **Step 1: Create MCP and Skills page**

Create `site/mcp-and-skills.md`:

```md
# MCP & Skills

asem integrates with AI clients through two separate setup surfaces:

1. MCP registration gives an Integration Target tools to operate on local Sessions and Messages.
2. Skill installation gives an Integration Target written guidance for using asem well.

These are independent. Installing a Skill never edits MCP config, and registering MCP never writes Skill files.

## Stdio MCP server

Start the server directly:

```sh
asem mcp
```

asem remains stdio-only. It does not start an HTTP server, expose a port, add a remote auth layer, or become a scheduler.

## Register MCP with an Integration Target

```sh
asem mcp add --for pi
asem mcp add --for antigravity
asem mcp add --for jcode
asem mcp add --for claude-code
asem mcp add --for opencode
asem mcp add --for codex
asem mcp add --for copilot-vscode
asem mcp add --for copilot-cli
```

Some targets support workspace-local config through `--no-global`:

```sh
asem mcp add --for claude-code --no-global
asem mcp add --for opencode --no-global
asem mcp add --for copilot-vscode --no-global
```

Unsupported scopes fail clearly instead of silently falling back.

## MCP tools

The MCP server exposes primitive Session and Message operations. It does not expose Integration Target setup commands.

Use the MCP surface for AI-facing local operations such as listing Sessions, reading Message history, sending Messages, and reporting to a parent Session.

## Install Skills

```sh
asem skills add --for pi
asem skills add --for antigravity
asem skills add --for jcode
asem skills add --for claude-code
asem skills add --for opencode
asem skills add --for codex
asem skills add --for copilot-vscode
asem skills add --for copilot-cli
```

Skill guidance explains asem vocabulary, scope, safety rules, and the intended MCP tool usage for that Integration Target.

## Scope reminder

An Integration Target is an external AI client whose local config can be updated. It is not the Session Agent, and it does not add teams, task lifecycle, worker pools, or workflow state to asem.
```

- [ ] **Step 2: Create developer docs page**

Create `site/developer-docs.md`:

```md
# Developer Docs

The public manual is user-centered. Maintainer and agent-facing design material stays in the repository's durable docs.

## Start here

- [Documentation map](https://github.com/takemo101/asem/blob/main/docs/README.md)
- [Domain vocabulary](https://github.com/takemo101/asem/blob/main/CONTEXT.md)
- [Session manager design](https://github.com/takemo101/asem/blob/main/docs/designs/asem-session-manager-design.md)
- [Architecture overview](https://github.com/takemo101/asem/blob/main/docs/architecture/overview.md)
- [Design principles](https://github.com/takemo101/asem/blob/main/docs/architecture/design-principles.md)
- [Implementation principles](https://github.com/takemo101/asem/blob/main/docs/architecture/implementation-principles.md)
- [ADRs](https://github.com/takemo101/asem/blob/main/docs/adr/README.md)

## Feature designs

- [Init Wizard](https://github.com/takemo101/asem/blob/main/docs/designs/init-wizard-design.md)
- [TUI Workspace Live Cockpit](https://github.com/takemo101/asem/blob/main/docs/designs/asem-tui-workspace-live-cockpit-design.md)
- [Agent Profiles](https://github.com/takemo101/asem/blob/main/docs/designs/agent-profiles-design.md)
- [Integration Targets](https://github.com/takemo101/asem/blob/main/docs/designs/integration-targets-design.md)

## Contribution baseline

Run the default checks before finalizing changes:

```sh
bun run typecheck
bun run test
bun run check
```

For documentation-only changes, also run:

```sh
bun run docs:build
bun test packages/cli/test/docs-links.test.ts
```
```

- [ ] **Step 3: Commit integration/developer pages**

Run:

```sh
but status -fv
but commit release-docs-site -m "Add integration manual pages" --changes <MCP_SKILLS_ID>,<DEVELOPER_DOCS_ID>
```

Expected: GitButler creates a commit containing both pages.

---

### Task 6: Final validation and cleanup

**Files:**
- Possibly modify: markdown pages if validation finds broken links or formatting issues.
- Possibly modify: `.gitignore` if generated VitePress cache/dist output appears unignored.

- [ ] **Step 1: Run VitePress build**

Run:

```sh
bun run docs:build
```

Expected: VitePress builds `site/.vitepress/dist` successfully.

- [ ] **Step 2: Ensure generated site output is not tracked**

Run:

```sh
but status -fv
```

Expected: `site/.vitepress/dist` and `site/.vitepress/cache` are not present as tracked/unassigned changes. If they appear, add these entries to `.gitignore`:

```gitignore
# VitePress output
site/.vitepress/dist/
site/.vitepress/cache/
```

Then run `but status -fv` again and include `.gitignore` in the next commit.

- [ ] **Step 3: Run docs link test**

Run:

```sh
bun test packages/cli/test/docs-links.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run full baseline**

Run:

```sh
bun run check
```

Expected: Biome, TypeScript, and Bun tests pass. If Biome reports formatting diffs, run:

```sh
bun run fix
```

Then repeat `bun run check`.

- [ ] **Step 5: Commit validation fixes if any**

If `.gitignore` or docs pages changed during validation, run:

```sh
but status -fv
but commit release-docs-site -m "Polish release docs validation" --changes <CHANGE_IDS>
```

Expected: validation-only fixes are committed.

- [ ] **Step 6: Push branch**

Run:

```sh
but push release-docs-site
```

Expected: remote branch is pushed.

- [ ] **Step 7: Open PR**

Write `/tmp/pr-release-docs-site.md` with:

```md
## Summary

- Add a public release README for asem.
- Add a VitePress user manual under `site/` with GitHub Pages base `/asem/`.
- Add docs build/preview scripts and VitePress dependency.

## Validation

- `bun run docs:build`
- `bun test packages/cli/test/docs-links.test.ts`
- `bun run check`

## Notes

- This PR does not add a GitHub Pages deployment workflow.
- Existing internal design docs remain under `docs/` and are linked from the manual's Developer Docs page.
```

Then run:

```sh
gh pr create --base main --head release-docs-site --title "Add release README and manual site" --body-file /tmp/pr-release-docs-site.md
```

Expected: PR URL is printed.

- [ ] **Step 8: Merge after checks**

Run:

```sh
gh pr view <PR_NUMBER> --json number,url,state,mergeable,statusCheckRollup
gh pr merge <PR_NUMBER> --squash --delete-branch --subject "Add release README and manual site" --body ""
```

Expected: PR is merged. If GitButler later reports the known stale applied branch integration edge, verify `origin/main` contains the merge commit, then run:

```sh
but unapply release-docs-site --status-after
but pull
but status -fv
```

---

## Self-Review

- Spec coverage: README, VitePress pages, package scripts, dependency, validation, external developer-doc links, and no-deploy boundary are each covered by tasks.
- Red-flag scan: The plan avoids unfinished-marker text and contains exact file paths and commands.
- Type consistency: VitePress config uses `defineConfig` from `vitepress`, package scripts match the spec, and Integration Target commands use `--for`, not `--agent`.
- Scope check: The plan is one documentation/manual-site slice and does not change CLI behavior, MCP tools, Session semantics, or deployment automation.
