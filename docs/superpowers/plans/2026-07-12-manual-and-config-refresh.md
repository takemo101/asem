# Manual and `.asem.yaml` configuration refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the public README and VitePress manual so they accurately describe the shipped Session, Message, root-launch, Cockpit, MCP/Skill, and `.asem.yaml` behavior, including practical Workspace configurations.

**Architecture:** Keep the README as a concise entry point and place operational detail in focused manual pages. Make `site/config.md` the configuration guide with three progressive Workspace examples; keep the runtime schema and CLI help authoritative rather than duplicating the template DSL. Add focused documentation-content assertions to the existing durable-docs suite so obsolete configuration keys and omitted operational guarantees are caught in the default test run.

**Tech Stack:** Markdown, VitePress, Bun test, TypeScript, Biome, GitButler (`but`).

## Global Constraints

- Documentation-only change: do not change config schemas, template runtime behavior, Session storage, operations, or TUI behavior.
- Preserve asem vocabulary: Session, Message, Report, Workspace, Worktree Root, Repo Alias, Multiplexer, Agent, Template, Command Sequence, Cockpit.
- Normal communication and parent-child relationships are Workspace-scoped; Worktree Root is location metadata and a filter, not a communication boundary.
- Repo Aliases choose a child Session `cwd`; they do not create a Workspace, parent, or Message/Report boundary.
- Do not introduce workflow, task, read-receipt, remote-tenancy, automatic-recovery, or outcome semantics.
- Use `but` for all version-control mutations; do not use git write commands.

---

### Task 1: Guard and rewrite the `.asem.yaml` configuration guide

**Files:**

- Modify: `packages/cli/test/docs-links.test.ts`
- Modify: `site/config.md`

**Interfaces:**

- Consumes: `configSchema` in `packages/core/src/types/config.ts`, which accepts `workspace`, optional `repos`, `agent`, and `mux`.
- Produces: a tested manual page that presents valid current configuration examples and describes the three Workspace layouts.

- [ ] **Step 1: Add a failing documentation-content test for current configuration examples**

  In `packages/cli/test/docs-links.test.ts`, add a test after the MCP deadline test that reads `site/config.md` and checks all of the following:

  ```ts
  test("site config guide uses the current configuration keys and workspace examples", () => {
    const contents = readFileSync(
      join(REPO_ROOT, "site", "config.md"),
      "utf8",
    );

    expect(contents).toContain("workspace:\n  id: acme");
    expect(contents).toContain("agent:\n  default: pi");
    expect(contents).toContain("mux:\n  default: herdr");
    expect(contents).toContain("repos:\n  frontend:\n    path: apps/frontend");
    expect(contents).toContain("`asem workspace repo list`");
    expect(contents).toContain("multiple Worktree Roots");
    expect(contents).not.toMatch(/^defaults:/m);
  });
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  ```

  Expected: FAIL because the current config page contains the obsolete `defaults:` YAML block and lacks the Repo Alias and multiple-Worktree examples.

- [ ] **Step 3: Replace `site/config.md` with the progressive configuration guide**

  Write the guide in this order:

  1. Explain that `.asem.yaml` lives at the Worktree Root and that `asem init --interactive` creates it.
  2. Show the exact minimal valid configuration:

     ```yaml
     workspace:
       id: acme

     agent:
       default: pi

     mux:
       default: herdr
     ```

  3. Add **One repository**: `asem doctor`, `asem run pi`, then `asem session create reviewer --prompt "Review the current diff"`; explain Workspace-scoped visibility, Messages, Reports, and parent-child relationships.
  4. Add **Monorepo with Repo Aliases** using this exact block:

     ```yaml
     workspace:
       id: acme

     repos:
       frontend:
         path: apps/frontend
       api:
         path: services/api

     agent:
       default: pi

     mux:
       default: herdr
     ```

     Include `asem workspace repo list` and `asem session create frontend-review --repo frontend --prompt "Review the frontend diff"`. State that the paths resolve relative to the declaring `.asem.yaml`, and that `--repo` changes only child `cwd`.

  5. Add **Multiple Worktree Roots, one Workspace** with two labelled `.asem.yaml` snippets that share `workspace.id: acme`, plus a prose diagram `Workspace acme → worktree-a / worktree-b`. Explain the shared Session tree and Message/Report boundary, Worktree Root metadata/filter role, and using different ids to intentionally isolate checkouts.
  6. Retain and contextualize the materialized herdr `send` migration under **Templates and upgrades**. State that existing config is never rewritten by `asem init`, template blocks are project-local overrides, and users must deliberately copy a refreshed block or remove an obsolete override to use a builtin again.
  7. Retain runtime token hygiene and distinguish Integration Target configuration from `.asem.yaml`.

- [ ] **Step 4: Run the targeted test and verify it passes**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  ```

  Expected: PASS, including the new configuration-content assertion.

- [ ] **Step 5: Commit the configuration-doc slice**

  Inspect the selected changes and commit only this task:

  ```sh
  but diff
  but commit docs-manual-config-refresh -m "docs: expand workspace configuration guide" --changes <config-doc-and-test-change-ids>
  ```

  Expected: one commit containing `site/config.md` and the configuration assertion in `packages/cli/test/docs-links.test.ts`.

### Task 2: Refresh Cockpit, root-session, and integration guidance

**Files:**

- Modify: `packages/cli/test/docs-links.test.ts`
- Modify: `site/tui.md`
- Modify: `site/quickstart.md`
- Modify: `site/cli.md`
- Modify: `site/mcp-and-skills.md`

**Interfaces:**

- Consumes: the MIK-059–069 public behavior described in `site/cli.md`, `site/concepts.md`, and the current Cockpit renderer.
- Produces: manual pages that distinguish durable protocol semantics from local presentation state and explain root-Session recovery without adding behavior.

- [ ] **Step 1: Add failing assertions for the current manual behavior**

  Add this test to `packages/cli/test/docs-links.test.ts`:

  ```ts
  test("manual covers the current Cockpit, root-session recovery, and Skill update behavior", () => {
    const tui = readFileSync(join(REPO_ROOT, "site", "tui.md"), "utf8");
    const cli = readFileSync(join(REPO_ROOT, "site", "cli.md"), "utf8");
    const skills = readFileSync(
      join(REPO_ROOT, "site", "mcp-and-skills.md"),
      "utf8",
    );

    expect(tui).toContain("Messages, Detail, and Context");
    expect(tui).toContain("in-memory");
    expect(tui).toContain("mouse wheel");
    expect(cli).toContain("stored mux reference is not edited in place");
    expect(skills).toContain("Re-running `asem skills add --for <target>`");
  });
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  ```

  Expected: FAIL because the current TUI page does not describe the right-pane tabs or scrolling, the CLI page lacks stale-pane recovery guidance, and the Skills page lacks upgrade guidance.

- [ ] **Step 3: Document the Cockpit's shipped right-pane behavior**

  Replace the `## What it shows` section in `site/tui.md` with concise subsections:

  - **Session tree**: Workspace-scoped tree, selected Session, and Worktree location context.
  - **Session dossier**: persistent selected-Session header plus **Messages, Detail, and Context** tabs.
  - **Messages**: timeline of durable Messages and Reports; Reports always show their body; ordinary Message bodies and Detail Technical data are expanded only through local ephemeral UI state.
  - **Activity**: capped **in-memory** snapshot-delta strip; it begins after Cockpit start, is not durable history/unread state, and disappears when no activity exists.
  - **Scrolling**: Messages, Detail, and Context use mouse wheel in-app scrolling for overflow; dossier, tabs, Activity, and global keybar remain fixed.

  Preserve the existing warning that Session status is not outcome.

- [ ] **Step 4: Update the root launch and stale-pane recovery guidance**

  In `site/quickstart.md`, insert `asem run pi` between `asem doctor` and child creation, explaining that it creates the human root Session and `session create` creates children.

  In `site/cli.md`, add a short **Recreating a root Session after replacing a pane** subsection after the Sessions section containing this exact operational rule:

  ```md
  A Session's stored mux reference is not edited in place. If its Multiplexer pane
  was replaced, Messages remain durable but best-effort pane notification can no
  longer reach that old pane. Keep or close the old Session for history, then run
  `asem run <agent>` from the live environment to create a new root Session.
  ```

  Do not call this automatic recovery and do not promise that existing child parent links are moved.

- [ ] **Step 5: Add Skill-update semantics**

  Add this paragraph under `## Install Skills` in `site/mcp-and-skills.md`:

  ```md
  Re-running `asem skills add --for <target>` replaces the asem-owned Skill file
  with the current guidance. It does not remove unrelated or user-authored Skills.
  Use `--no-global` again when the target supports and should use workspace-local
  configuration.
  ```

  Keep the existing separation between MCP registration and Skill installation.

- [ ] **Step 6: Run the targeted test and verify it passes**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  ```

  Expected: PASS, including the new Cockpit, recovery, and Skill-update assertions.

- [ ] **Step 7: Commit the manual-behavior slice**

  Inspect and commit the five manual-page edits plus their test assertion:

  ```sh
  but diff
  but commit docs-manual-config-refresh -m "docs: describe current cockpit and session recovery" --changes <manual-page-and-test-change-ids>
  ```

  Expected: one focused commit after the configuration-doc commit.

### Task 3: Refresh README and validate the published manual

**Files:**

- Modify: `README.md`
- Modify: `site/index.md`
- Modify: `packages/cli/test/docs-links.test.ts`

**Interfaces:**

- Consumes: the detailed manual pages from Tasks 1–2.
- Produces: a concise repository and VitePress entry point that routes users to the detailed manual without duplicating its reference material.

- [ ] **Step 1: Add a failing README/manual entry-point assertion**

  Add this test to `packages/cli/test/docs-links.test.ts`:

  ```ts
  test("README and manual home route users to current setup guidance", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    const home = readFileSync(join(REPO_ROOT, "site", "index.md"), "utf8");

    expect(readme).toContain("`asem run <agent>`");
    expect(readme).toContain("Session dossier");
    expect(readme).toContain("[Configuration](https://takemo101.github.io/asem/config)");
    expect(home).toContain("durable local Messages");
    expect(home).toContain("root Session");
  });
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  ```

  Expected: FAIL because the current README has no Configuration manual link or dossier wording, and the home page does not identify durable Messages/root launch.

- [ ] **Step 3: Refresh the short public entry points**

  In `README.md`:

  - keep the existing install section and short Quickstart;
  - add a short sentence that `asem run <agent>` is the root human launcher and `asem session create` is for child Sessions;
  - change the Cockpit description to say it is a selected-Session dossier with Messages, Detail, and Context;
  - link the existing manual URL to `/config`, `/tui`, and `/cli` using absolute manual links; and
  - leave template configuration detail in `site/config.md` rather than duplicating YAML blocks.

  In `site/index.md`:

  - change the Messages feature detail to call Messages durable local communication whose pane delivery is best-effort;
  - add or revise one feature to identify root Session launch plus child Session creation; and
  - retain the explicit non-workflow positioning.

- [ ] **Step 4: Run targeted docs tests and build the VitePress manual**

  Run:

  ```sh
  bun test packages/cli/test/docs-links.test.ts
  bun run docs:build
  ```

  Expected: both commands PASS. The build must report no broken VitePress route links.

- [ ] **Step 5: Run the repository baseline**

  Run:

  ```sh
  bun run typecheck
  bun run test
  bun run check
  ```

  Expected: all commands PASS. Existing non-gating warnings may be reported but no new errors are acceptable.

- [ ] **Step 6: Commit the README/manual-entry slice**

  Inspect and commit only the final entry-point changes and their assertion:

  ```sh
  but diff
  but commit docs-manual-config-refresh -m "docs: refresh public setup guidance" --changes <readme-home-and-test-change-ids>
  ```

  Expected: the branch contains three focused documentation commits after the approved design commit.

## Plan self-review

- **Spec coverage:** Task 1 implements the three Workspace configurations, current config keys, Repo Alias semantics, template upgrade guidance, and token hygiene. Task 2 implements Cockpit, root `asem run`, stale-pane recovery, and Skill-update guidance. Task 3 updates README and VitePress entry points. All requested public surfaces and validation requirements are covered.
- **Placeholder scan:** No task uses TBD/TODO, “implement later,” or unspecified test instructions. GitButler change IDs are intentionally resolved at execution time by `but diff`, as required by GitButler's mutable ID model.
- **Consistency:** All examples use the current `workspace`, `agent`, `mux`, and optional `repos` config shape. All Message and scope language preserves the Workspace boundary and notification-only delivery behavior.
