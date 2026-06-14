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
