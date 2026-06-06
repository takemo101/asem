# AGENTS.md

Guidance for AI coding agents working on asem.

## Entry points

Use this file as the agent workflow entry point. For design details, follow the durable docs:

1. [`docs/README.md`](docs/README.md) — documentation map.
2. [`CONTEXT.md`](CONTEXT.md) — canonical asem domain language.
3. [`docs/designs/asem-session-manager-design.md`](docs/designs/asem-session-manager-design.md) — MVP Session manager design.
4. [`docs/architecture/overview.md`](docs/architecture/overview.md) — package/module boundaries and dependency direction.
5. [`docs/architecture/design-principles.md`](docs/architecture/design-principles.md) — design guardrails.
6. [`docs/architecture/implementation-principles.md`](docs/architecture/implementation-principles.md) — implementation and testability rules.
7. [`docs/adr/`](docs/adr/) — durable trade-off decisions.

Before changing behavior, public surfaces, architecture, package boundaries, storage, runtime templates, auth/scope semantics, or terminology, read the relevant linked docs first.

Design details intentionally live in `docs/` plus `CONTEXT.md`. Do not duplicate detailed design rules in this file.

`HANDOFF.md` is a historical handoff, not the long-term source of truth. If it conflicts with `docs/` or `CONTEXT.md`, trust the durable docs and update them when needed.

## Scope guard

asem is intentionally small. It is a local agent Session manager, not a task/workflow/team orchestration system.

If a change starts adding any of these concepts, stop and re-check the design docs before proceeding:

- task lifecycle states such as completed/failed/blocked;
- task events or event streams;
- roles, positions, teams, coordinators, strategies, worker pools, or swarm runtime behavior;
- result normalization or success/failure interpretation;
- automatic scheduling, auto-wake, or durable unread/read receipt state;
- worktree creation, Git branch management, artifact management, or remote tenancy.

Use the project vocabulary from [`CONTEXT.md`](CONTEXT.md): Session, Message, Report, Workspace, Worktree Root, Effective Scope, Multiplexer, Agent, Template, Command Sequence, Cockpit.

## Architecture rules

Keep implementation modular and testable.

- `@asem/core` owns domain types, schemas, operation contracts, port interfaces, token helpers, and pure shell escaping helpers.
- `@asem/runtime` owns template registry, template interpolation, sequence execution, capture handling, and fake runner contract.
- `@asem/store` owns SQLite migrations, row mapping, scoped CRUD, and transaction primitives.
- `@asem/ops` owns shared operation handlers, auth/scope checks, use-case semantics, and operation-level cleanup.
- `@asem/cli`, `@asem/mcp`, and `@asem/tui` are surface projections. They must not duplicate semantic operation logic.

Do not import concrete SQLite connections, real shell execution, or terminal UI into `@asem/core` or `@asem/ops`. Use injected ports.

## Development workflow

Develop in small, testable slices.

1. Identify exactly one behavior or doc slice.
2. Re-read the relevant sections of `docs/` and `CONTEXT.md`.
3. Confirm whether the change affects domain language, package boundaries, storage, templates, CLI/MCP/TUI surfaces, or auth/scope semantics.
4. Update or add tests for the slice before broadening scope.
5. Prefer fake ports and fake runners over real shell/mux/agent dependencies.
6. Run the relevant checks.
7. Request or perform review before moving to the next slice.
8. Update durable docs in the same change when documented boundaries change.

Avoid opportunistic unrelated refactors.

## Testability rules

Default tests must not require real multiplexers or real agent CLIs.

Use fake/injected dependencies for:

- `Store`
- `TemplateRegistry`
- `CommandRunner` / `TemplateRunner`
- `FileSystem`
- `ConfigLoader`
- `ScopeResolver`
- `CurrentSessionResolver`
- `LivenessProbe`
- `Clock`
- `IdGenerator`
- `TokenGenerator`
- `Logger` / `Redactor`

Fake runner tests should verify command order, `cwd`, `env`, timeout/background flags, stdout/stderr/exit-code scripting, capture success/failure, virtual time, failure injection, cleanup behavior, and secret redaction.

Real herdr/tmux/zellij integration tests are optional and must skip when binaries are unavailable.

## Security and state rules

- Normal visibility and messaging are scoped by `workspace_id + worktree_root`.
- Session status is process/connection state only; never infer work outcome.
- Store only token hashes in SQLite.
- Keep token-bearing files mode `0600` and under ignored runtime paths such as `.asem/sessions/`, `.asem/current-session*.json`, or `.asem/tokens/`.
- Do not put tokens in command-line args, pane labels, logs, or structured errors when avoidable.
- Message delivery is best-effort: persist `delivered_at` on success or `delivery_error` on failure; do not fabricate ack/read state.

## GitButler / but workflow

Use the `but` GitButler workflow for version-control mutations when this directory is a GitButler-managed repository.

- Use `but status -fv` before version-control mutations.
- Use `but` instead of git write commands.
- Do not run `git add`, `git commit`, `git push`, `git checkout`, `git merge`, `git rebase`, or `git stash` for write operations.
- Use IDs reported by `but status -fv`, `but diff`, or `but show`; do not hardcode IDs.

Read-only git inspection is acceptable when needed. If `but` reports that the directory is not set up, do not force GitButler operations; ask or proceed without version-control mutation.

## Checks

Once the workspace exists, the expected baseline is:

```sh
bun run typecheck
bun run test
bun run check
```

For small package slices, run the package-specific command first, then broader checks before finalizing.

A Lefthook `pre-commit` hook (see [`lefthook.yml`](lefthook.yml)) runs the same baseline (`bun run typecheck`, `bun run test`, `bun run check`) sequentially. `lefthook` is a root devDependency and `bun install` wires the hook via the `prepare` script, so contributors get it automatically; re-run `bunx lefthook install` if hooks ever fall out of sync.

Until implementation is scaffolded, documentation-only checks are:

```sh
find docs -name '*.md' -print
```

and a link/placeholder scan if available.

## Documentation rules

Keep durable design material in docs, not in `AGENTS.md`.

- Update [`CONTEXT.md`](CONTEXT.md) when domain vocabulary changes.
- Update [`docs/designs/`](docs/designs/) when feature/subsystem design changes.
- Update [`docs/architecture/`](docs/architecture/) when package boundaries, dependency direction, design principles, or implementation principles change.
- Add ADRs under [`docs/adr/`](docs/adr/) only for decisions that are hard to reverse, surprising without context, and trade-off driven.

`AGENTS.md` should stay focused on agent workflow and pointers to canonical docs.
