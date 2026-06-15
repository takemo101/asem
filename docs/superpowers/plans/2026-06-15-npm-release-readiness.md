# npm Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare asem for npm publication as `@takemo101/asem@0.0.1` without publishing until the final release gate.

**Architecture:** Publish only the CLI package as a bundled Bun artifact. Internal `@asem/*` workspace packages remain private source packages and are bundled into `packages/cli/dist/bin.js`; the packed npm manifest must not contain `workspace:*` runtime dependencies. Add a top-level version display and a Trusted Publishing workflow that verifies the packed tarball before publishing.

**Tech Stack:** Bun bundler, TypeScript, npm pack/install verification, GitHub Actions Trusted Publishing, existing Bun tests, GitButler CLI.

---

## File Structure

- Modify `packages/cli/package.json`: publish metadata, version, bin path, build scripts, optional OpenTUI native dependencies, and publish-safe dependency shape.
- Create `packages/cli/README.md`: concise npm package page.
- Modify `package.json`: add root `build` script.
- Modify `packages/cli/src/parse.ts`: add a typed top-level version parse result.
- Modify `packages/cli/src/run.ts`: emit package version for version requests.
- Modify `packages/cli/src/main.ts`: treat version requests as read-only so they do not open durable state.
- Modify `packages/cli/test/parse.test.ts`: cover `--version` and `-v` parsing.
- Modify `packages/cli/test/run.test.ts`: cover version output and no operation side effects.
- Modify `packages/cli/test/main.test.ts`: cover read-only classification for version requests.
- Create `.github/workflows/publish.yml`: npm Trusted Publishing workflow.
- Modify `bun.lock`: only if package metadata/dependency changes require a lockfile update.

---

### Task 1: Add CLI version request support

**Files:**
- Modify: `packages/cli/src/parse.ts`
- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/src/main.ts`
- Test: `packages/cli/test/parse.test.ts`
- Test: `packages/cli/test/run.test.ts`
- Test: `packages/cli/test/main.test.ts`

- [ ] **Step 1: Add parser tests for version flags**

In `packages/cli/test/parse.test.ts`, inside `describe("parseArgs help", ...)`, add:

```ts
test("--version and -v request the package version", () => {
  expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  expect(parseArgs(["-v"])).toEqual({ kind: "version" });
});
```

Run:

```sh
bun test packages/cli/test/parse.test.ts
```

Expected: TypeScript or runtime failure because `ParseResult` does not yet include `version`.

- [ ] **Step 2: Add runCli tests for version output**

In `packages/cli/test/run.test.ts`, inside `describe("runCli help & usage", ...)`, add:

```ts
test("--version prints the package version and exits 0", async () => {
  const { io, code } = await run(["--version"]);
  expect(code).toBe(EXIT_OK);
  expect(io.outText()).toBe("0.0.1\n");
  expect(io.errText()).toBe("");
});

test("-v prints the package version and exits 0", async () => {
  const { io, code } = await run(["-v"]);
  expect(code).toBe(EXIT_OK);
  expect(io.outText()).toBe("0.0.1\n");
  expect(io.errText()).toBe("");
});
```

Run:

```sh
bun test packages/cli/test/run.test.ts
```

Expected: failure because version dispatch does not exist.

- [ ] **Step 3: Add read-only classification test**

In `packages/cli/test/main.test.ts`, find the `isReadOnlyCommand` tests and add assertions that `--version` and `-v` are read-only:

```ts
expect(isReadOnlyCommand(["--version"])).toBe(true);
expect(isReadOnlyCommand(["-v"])).toBe(true);
```

Run:

```sh
bun test packages/cli/test/main.test.ts
```

Expected: failure because version is not currently handled.

- [ ] **Step 4: Extend ParseResult**

In `packages/cli/src/parse.ts`, change the `ParseResult` type to include a version result:

```ts
export type ParseResult =
  | { kind: "command"; command: CliCommand }
  | { kind: "help"; topic?: string }
  | { kind: "version" }
  | { kind: "error"; error: OperationError };
```

Add a helper near `isHelpFlag`:

```ts
function isVersionFlag(arg: string | undefined): boolean {
  return arg === "--version" || arg === "-v";
}
```

At the start of `parseArgs`, after destructuring `command`, add:

```ts
if (isVersionFlag(command)) {
  if (rest.length > 0) {
    return invalid("version accepts no extra arguments", { extra: rest });
  }
  return { kind: "version" };
}
```

Keep help behavior unchanged.

- [ ] **Step 5: Emit package version in runCli**

In `packages/cli/src/run.ts`, import package metadata:

```ts
import packageJson from "../package.json" with { type: "json" };
```

In `runCli`, after the help branch and before the error branch, add:

```ts
if (parsed.kind === "version") {
  io.out(`${packageJson.version}\n`);
  return EXIT_OK;
}
```

This couples output to `packages/cli/package.json`.

- [ ] **Step 6: Make version read-only in main**

In `packages/cli/src/main.ts`, add a helper:

```ts
function isVersionRequest(argv: readonly string[]): boolean {
  return argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v");
}
```

In `isReadOnlyCommand`, add:

```ts
if (isVersionRequest(argv)) return true;
```

This prevents `asem --version` from opening SQLite or creating `~/.asem`.

- [ ] **Step 7: Run targeted tests**

Run:

```sh
bun test packages/cli/test/parse.test.ts
bun test packages/cli/test/run.test.ts
bun test packages/cli/test/main.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit version support**

Run:

```sh
but status -fv
but commit npm-release-readiness -m "Add CLI version output" --changes <PARSE_ID>,<RUN_ID>,<MAIN_ID>,<PARSE_TEST_ID>,<RUN_TEST_ID>,<MAIN_TEST_ID>
```

Expected: GitButler creates a commit containing only version flag behavior and tests.

---

### Task 2: Make the CLI package publish-ready

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `package.json`
- Modify: `bun.lock` if generated by install/build metadata changes

- [ ] **Step 1: Update CLI package metadata**

Modify `packages/cli/package.json` to use this publish-ready shape:

```json
{
  "name": "@takemo101/asem",
  "version": "0.0.1",
  "private": false,
  "type": "module",
  "description": "Local agent Session manager CLI",
  "bin": {
    "asem": "dist/bin.js"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/takemo101/asem"
  },
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "bun run build:dist && tsc -p ../../tsconfig.json --noEmit",
    "build:dist": "bun build ./src/index.ts --target=bun --outdir=./dist --entry-naming=bin.js",
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "optionalDependencies": {
    "@opentui/core-darwin-arm64": "0.2.1",
    "@opentui/core-darwin-x64": "0.2.1",
    "@opentui/core-linux-arm64": "0.2.1",
    "@opentui/core-linux-x64": "0.2.1",
    "@opentui/core-win32-arm64": "0.2.1",
    "@opentui/core-win32-x64": "0.2.1"
  },
  "dependencies": {
    "@inquirer/prompts": "^8.5.2"
  }
}
```

Do not include `@asem/*` `workspace:*` dependencies in the publish manifest. TypeScript development imports are resolved by root `tsconfig.base.json` paths, and the publish artifact is bundled.

- [ ] **Step 2: Add root build script**

In root `package.json`, add:

```json
"build": "cd packages/cli && bun run build"
```

Keep root `private: true` unchanged.

- [ ] **Step 3: Refresh install metadata if needed**

Run:

```sh
bun install --ignore-scripts
```

Expected: `bun.lock` updates only if Bun needs to reflect package metadata/dependency changes. Do not run the normal install path if the local Lefthook prepare hook still hits the known hook rename collision.

- [ ] **Step 4: Format package JSON files**

Run:

```sh
bunx biome format --write package.json packages/cli/package.json
```

Expected: formatted JSON.

- [ ] **Step 5: Build CLI package**

Run:

```sh
bun run build
```

Expected: `packages/cli/dist/bin.js` and related emitted assets are generated, and TypeScript typecheck passes.

- [ ] **Step 6: Verify source CLI version**

Run:

```sh
bun packages/cli/src/index.ts --version
bun packages/cli/src/index.ts -v
```

Expected: each command prints exactly `0.0.1`.

- [ ] **Step 7: Commit package metadata**

Run:

```sh
but status -fv
but commit npm-release-readiness -m "Prepare CLI package for npm" --changes <CLI_PACKAGE_JSON_ID>,<ROOT_PACKAGE_JSON_ID>,<LOCKFILE_ID_IF_PRESENT>
```

Expected: GitButler creates a commit. Do not commit `packages/cli/dist` yet unless the project decides generated dist should be tracked. npm pack will include dist from the workflow build, not from git history.

---

### Task 3: Add npm package README

**Files:**
- Create: `packages/cli/README.md`

- [ ] **Step 1: Write package README**

Create `packages/cli/README.md`:

```md
# @takemo101/asem

asem is a local agent Session manager for AI-assisted development. It helps a human or parent agent create child Sessions, exchange Messages, collect Reports, and inspect local work from a CLI, TUI Cockpit, or stdio MCP server.

Manual: <https://takemo101.github.io/asem/>
Repository: <https://github.com/takemo101/asem>

## Install

```sh
npm install -g @takemo101/asem
```

The package installs the `asem` binary.

Verify the installed version:

```sh
asem --version
```

## Quickstart

```sh
cd /path/to/your/repo
asem init --interactive
asem doctor
asem session create reviewer-1 --profile reviewer --prompt "Review the current diff"
asem message list
asem tui
```

## What it provides

- **Local Sessions**: create and inspect child agent Sessions in a Workspace and Worktree Root.
- **Messages and Reports**: keep durable local communication history between parent and child Sessions.
- **Multiplexer Templates**: launch through tmux, zellij, herdr, rmux, or project-local Templates.
- **Agent Profiles**: shape child prompts with explicit Profiles such as `reviewer`, `worker`, and `planner`.
- **TUI Cockpit**: inspect Sessions and local activity from a keyboard-first terminal surface.
- **Stdio MCP server**: expose primitive Session and Message operations to compatible AI clients.
- **Integration Target setup**: register MCP or install Skill guidance for supported external AI clients.

asem is intentionally small. It is not a task board, scheduler, hosted service, workflow engine, or result evaluator.

## More information

See the manual for concepts, CLI usage, TUI behavior, Agent Profiles, MCP setup, Skills, and configuration:

<https://takemo101.github.io/asem/>
```

- [ ] **Step 2: Commit package README**

Run:

```sh
but status -fv
but commit npm-release-readiness -m "Add npm package README" --changes <CLI_README_ID>
```

Expected: GitButler creates a commit containing only `packages/cli/README.md`.

---

### Task 4: Add npm publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create workflow**

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"

      - name: Ensure npm supports Trusted Publishing
        run: |
          npm install -g npm@latest
          node --version
          npm --version

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.13"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run checks and build dist
        run: |
          bun run typecheck
          bun run test
          bun run check
          bun run docs:build
          bun run build

      - name: Verify CLI version
        run: |
          test "$(bun packages/cli/src/index.ts --version)" = "0.0.1"
          test "$(bun packages/cli/src/index.ts -v)" = "0.0.1"

      - name: Verify publish package contents
        run: |
          test -f packages/cli/dist/bin.js || (echo "dist/bin.js not found" && exit 1)
          test -f packages/cli/README.md || (echo "packages/cli/README.md not found" && exit 1)
          node <<'NODE'
          const { execFileSync } = require('node:child_process');
          const cliPackage = require('./packages/cli/package.json');
          if (cliPackage.name !== '@takemo101/asem') throw new Error(`Unexpected package name ${cliPackage.name}`);
          if (cliPackage.version !== '0.0.1') throw new Error(`Unexpected package version ${cliPackage.version}`);
          const deps = { ...cliPackage.dependencies, ...cliPackage.optionalDependencies };
          for (const [name, version] of Object.entries(deps)) {
            if (String(version).startsWith('workspace:')) throw new Error(`Publish manifest contains workspace dependency ${name}`);
          }
          const platform = process.platform;
          const arch = process.arch;
          const nativePackage = `@opentui/core-${platform}-${arch}`;
          if (cliPackage.optionalDependencies?.[nativePackage] !== '0.2.1') {
            throw new Error(`Missing optional dependency ${nativePackage}@0.2.1`);
          }
          const pack = execFileSync('npm', ['pack', '--dry-run', '--json', './packages/cli'], { encoding: 'utf8' });
          const [packed] = JSON.parse(pack);
          const files = new Set(packed.files.map((file) => file.path));
          for (const required of ['dist/bin.js', 'README.md', 'package.json']) {
            if (!files.has(required)) throw new Error(`Packed package missing ${required}`);
          }
          if (files.has('src/index.ts')) throw new Error('Packed package must not include src/index.ts');
          console.log(`Verified ${packed.name}@${packed.version} package contents`);
          NODE

      - name: Verify installed package
        run: |
          tmpdir="$(mktemp -d)"
          npm pack ./packages/cli --pack-destination "$tmpdir"
          tarball="$(find "$tmpdir" -name '*.tgz' -print -quit)"
          cd "$tmpdir"
          npm install "$tarball"
          bun -e 'const native = `@opentui/core-${process.platform}-${process.arch}`; await import(native); console.log(`loaded ${native}`);'
          ./node_modules/.bin/asem --help
          test "$(./node_modules/.bin/asem --version)" = "0.0.1"

      - name: Publish to npm with Trusted Publishing
        run: |
          cd packages/cli
          npm publish --provenance --access public
```

- [ ] **Step 2: Validate workflow references**

Run:

```sh
python3 - <<'PY'
from pathlib import Path
text = Path('.github/workflows/publish.yml').read_text()
required = [
    'npm publish --provenance --access public',
    'bun run docs:build',
    'bun run build',
    '@takemo101/asem',
    '0.0.1',
    './node_modules/.bin/asem --version',
]
missing = [item for item in required if item not in text]
if missing:
    raise SystemExit(f'missing workflow fragments: {missing}')
print('publish workflow content ok')
PY
```

Expected: `publish workflow content ok`.

- [ ] **Step 3: Commit workflow**

Run:

```sh
but status -fv
but commit npm-release-readiness -m "Add npm publish workflow" --changes <PUBLISH_WORKFLOW_ID>
```

Expected: GitButler creates a commit containing `.github/workflows/publish.yml`.

---

### Task 5: Validate packed package locally

**Files:**
- Possibly modify earlier files if validation fails.

- [ ] **Step 1: Build the publish artifact**

Run:

```sh
bun run build
```

Expected: build succeeds and `packages/cli/dist/bin.js` exists.

- [ ] **Step 2: Verify packed manifest has no workspace dependencies**

Run:

```sh
node <<'NODE'
const { execFileSync } = require('node:child_process');
const pack = execFileSync('npm', ['pack', '--dry-run', '--json', './packages/cli'], { encoding: 'utf8' });
const [packed] = JSON.parse(pack);
if (packed.name !== '@takemo101/asem') throw new Error(`Unexpected package ${packed.name}`);
if (packed.version !== '0.0.1') throw new Error(`Unexpected version ${packed.version}`);
const pkg = require('./packages/cli/package.json');
const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
for (const [name, version] of Object.entries(deps)) {
  if (String(version).startsWith('workspace:')) throw new Error(`workspace dependency leaked: ${name}`);
}
const files = new Set(packed.files.map((file) => file.path));
for (const required of ['dist/bin.js', 'README.md', 'package.json']) {
  if (!files.has(required)) throw new Error(`missing ${required}`);
}
if (files.has('src/index.ts')) throw new Error('src/index.ts should not be packed');
console.log(`pack dry-run ok: ${packed.name}@${packed.version}`);
NODE
```

Expected: dry-run succeeds.

- [ ] **Step 3: Install tarball in an isolated temp directory**

Run:

```sh
tmpdir="$(mktemp -d)"
npm pack ./packages/cli --pack-destination "$tmpdir"
tarball="$(find "$tmpdir" -name '*.tgz' -print -quit)"
cd "$tmpdir"
npm install "$tarball"
./node_modules/.bin/asem --help >/tmp/asem-help.txt
test "$(./node_modules/.bin/asem --version)" = "0.0.1"
bun -e 'const native = `@opentui/core-${process.platform}-${process.arch}`; await import(native); console.log(`loaded ${native}`);'
```

Expected: install succeeds, help runs, version is `0.0.1`, and native OpenTUI package imports.

- [ ] **Step 4: Run docs and full checks**

Run:

```sh
bun run docs:build
bun run check
```

Expected: both pass.

- [ ] **Step 5: Commit validation fixes if needed**

If validation required edits, run:

```sh
but status -fv
but commit npm-release-readiness -m "Polish npm release validation" --changes <CHANGE_IDS>
```

Expected: validation fixes are committed. If no files changed, skip this step.

---

### Task 6: Open release-readiness PR and stop before publish

**Files:**
- No source changes expected.

- [ ] **Step 1: Push branch**

Run:

```sh
but push npm-release-readiness
```

Expected: remote branch is pushed.

- [ ] **Step 2: Create PR body**

Write `/tmp/pr-npm-release-readiness.md`:

```md
## Summary

- Prepare `packages/cli` for npm publication as `@takemo101/asem@0.0.1`.
- Add `asem --version` / `asem -v` for install verification.
- Add npm package README and Trusted Publishing workflow.
- Add local and CI checks for packed package contents and installed tarball behavior.

## Validation

- `bun run build`
- `npm pack --dry-run --json ./packages/cli`
- isolated tarball install + `asem --help` + `asem --version`
- `bun run docs:build`
- `bun run check`

## Release Gate

This PR does not publish to npm. After merge, confirm before creating `v0.0.1` or triggering the publish workflow.
```

- [ ] **Step 3: Open PR**

Run:

```sh
gh pr create --base main --head npm-release-readiness --title "Prepare npm release" --body-file /tmp/pr-npm-release-readiness.md
```

Expected: PR URL is printed.

- [ ] **Step 4: Merge only after review/validation**

After checks and review, merge with:

```sh
gh pr merge <PR_NUMBER> --squash --delete-branch --subject "Prepare npm release" --body ""
```

Expected: PR merges. If GitButler reports the known stale branch integration edge after merge, verify `origin/main` contains the merge commit, then run:

```sh
but unapply npm-release-readiness --status-after
but pull
but status -fv
```

- [ ] **Step 5: Stop for publish confirmation**

Ask the user to confirm final publication:

```txt
Ready to publish @takemo101/asem@0.0.1. Confirm creating tag v0.0.1 and triggering npm Trusted Publishing?
```

Do not create tags or run publish before that confirmation.

---

## Self-Review

- Spec coverage: package metadata, version flags, root build script, npm README, publish workflow, packed package validation, and release gate are each covered.
- Red-flag scan: no unfinished markers or vague implementation steps remain.
- Type consistency: version parse result is named `version` in parser and run dispatch; package version is consistently `0.0.1`; package name is consistently `@takemo101/asem`.
- Scope check: plan does not publish, does not make internal packages public, and changes CLI behavior only for top-level version display.
