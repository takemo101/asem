# npm Release Readiness Design

## Goal

Prepare asem for npm publication as `@takemo101/asem`, matching the mikan release pattern while preserving asem's package boundaries and local-first runtime semantics.

## Context

The repository is now public, has a release README, has a VitePress manual, and deploys the manual through GitHub Pages. The CLI package is not yet publish-ready:

- `packages/cli/package.json` is private and named `@asem/cli`.
- The CLI binary points at TypeScript source.
- Workspace dependencies use `workspace:*`, which cannot be published as a standalone npm package.
- `packages/cli/README.md` does not exist.
- There is no npm publish workflow.

A local probe showed that `bun build ./packages/cli/src/index.ts --target=bun` can produce a standalone `dist/bin.js` and that the bundled binary can render `asem --help` and `asem doctor --json` from an isolated directory.

## Decisions

- Publish only the CLI package, not every internal workspace package.
- Publish package name is `@takemo101/asem`.
- Initial release version is `0.1.0`.
- The package installs an `asem` binary backed by `dist/bin.js`.
- The package includes `dist` and `README.md` only.
- Internal `@asem/*` workspace packages remain private source packages and are bundled into the CLI artifact.
- The publish workflow uses npm Trusted Publishing with provenance, like mikan.
- Actual tag creation and npm publication require a final explicit user confirmation after the release-readiness PR is merged.

## Package Metadata

Modify `packages/cli/package.json`:

- `name`: `@takemo101/asem`
- `version`: `0.1.0`
- `private`: `false`
- `bin.asem`: `dist/bin.js`
- `repository.type`: `git`
- `repository.url`: `https://github.com/takemo101/asem`
- `files`: `["dist", "README.md"]`
- `publishConfig.access`: `public`
- add `build:dist`: `bun build ./src/index.ts --target=bun --outdir=./dist --entry-naming=bin.js`
- add `build`: `bun run build:dist && tsc -p ../../tsconfig.json --noEmit`

Keep workspace dependencies for development and tests. They are bundled into `dist/bin.js` and should not appear in packed package contents as `workspace:*` runtime dependencies if npm pack validation reveals they would break install. If needed, remove package dependencies from the packed manifest only by changing `packages/cli/package.json` to avoid workspace dependency publication, and rely on the bundled artifact plus optional native dependencies.

## Native Optional Dependencies

The TUI depends on OpenTUI native platform packages through `@opentui/core`. The npm package should include optional dependencies for the OpenTUI native packages matching the current runtime version:

- `@opentui/core-darwin-arm64`: `0.2.1`
- `@opentui/core-darwin-x64`: `0.2.1`
- `@opentui/core-linux-arm64`: `0.2.1`
- `@opentui/core-linux-x64`: `0.2.1`
- `@opentui/core-win32-arm64`: `0.2.1`
- `@opentui/core-win32-x64`: `0.2.1`

The publish verification should install the packed tarball in a temporary directory and confirm the current platform native package can be imported.

## Root Scripts

Modify root `package.json`:

- add `build`: `cd packages/cli && bun run build`

Do not change the root package's private status.

## npm README

Create `packages/cli/README.md` as a concise package page:

- Package name: `@takemo101/asem`
- Manual link: `https://takemo101.github.io/asem/`
- Install command: `npm install -g @takemo101/asem`
- Quickstart commands.
- Short feature list.
- Link back to the GitHub repository.

## Publish Workflow

Create `.github/workflows/publish.yml` matching mikan's Trusted Publishing shape:

- Trigger on tags matching `v*` and `workflow_dispatch`.
- Use Node.js 24 and npm registry URL.
- Upgrade npm to latest to ensure Trusted Publishing support.
- Setup Bun `1.3.13`.
- `bun install --frozen-lockfile`.
- Run:
  - `bun run typecheck`
  - `bun run test`
  - `bun run check`
  - `bun run docs:build`
  - `bun run build`
- Verify package contents:
  - `packages/cli/dist/bin.js` exists.
  - `packages/cli/README.md` exists.
  - `npm pack --dry-run --json ./packages/cli` contains `dist/bin.js`, `README.md`, `package.json`, and emitted dist assets.
  - packed contents do not include `src/index.ts`.
  - package name is `@takemo101/asem` and version is `0.1.0`.
- Verify installed package:
  - `npm pack ./packages/cli` to a temp directory.
  - `npm install <tarball>`.
  - import the current platform `@opentui/core-${process.platform}-${process.arch}` native package.
  - run `./node_modules/.bin/asem --help`.
- Publish:
  - `cd packages/cli`
  - `npm publish --provenance --access public`

## Validation Before Merge

Required local checks:

1. `bun run build`
2. `npm pack --dry-run --json ./packages/cli`
3. install the packed tarball in a temporary directory and run `asem --help`
4. `bun run docs:build`
5. `bun run check`

If `npm pack` shows `workspace:*` dependencies in the publish manifest, stop and fix package metadata before opening the PR.

## Release Gate

After the PR is merged, do not create a release tag or trigger publication until the user explicitly confirms the final package name and version. The expected first release tag is `v0.1.0`.

## Boundaries

This work must not:

- publish during implementation;
- make internal `@asem/*` packages public;
- change CLI behavior, Session semantics, store schema, MCP tools, or TUI behavior;
- add release automation beyond the npm publish workflow;
- change GitHub Pages workflow or manual content except for links needed by package docs.
