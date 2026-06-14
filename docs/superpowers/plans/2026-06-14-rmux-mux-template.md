# RMUX Multiplexer Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `rmux` as a builtin asem Multiplexer Template.

**Architecture:** Implement RMUX as a declarative `@asem/runtime` mux template that mirrors tmux-like lifecycle semantics while using conservative RMUX commands. Test through the fake TemplateRunner first; real RMUX integration remains optional and skipped unless available.

**Tech Stack:** TypeScript, Bun tests, `@asem/runtime` template registry, GitButler, mikan.

---

## Task 1: Add failing fake-runner tests

**Files:**
- Modify: `packages/runtime/test/builtin-mux.test.ts`

- [ ] Add a `describe("builtin mux: rmux", ...)` block after tmux tests.
- [ ] Assert `create` runs `rmux new-session -d -s 's_0001' -c '/repo'`, then `rmux list-panes -t 's_0001' -F '#{pane_id}'` and captures pane id `%7`.
- [ ] Assert refs include `{ rmux_session_name: "s_0001", pane_id: "%7" }`.
- [ ] Assert `run_in_pane`, `send`, `attach`, and `close` commands use `rmux` and target `rmux_session_name`.
- [ ] Add `rmux` to builtin mux id enumeration tests if present.
- [ ] Run `bun test packages/runtime/test/builtin-mux.test.ts` and verify failure because `rmux` is not registered.
- [ ] Commit failing tests with `--no-hooks` if the pre-commit hook blocks the intentional red state.

## Task 2: Implement builtin rmux template

**Files:**
- Modify: `packages/runtime/src/template/builtin.ts`

- [ ] Add `rmux` to `builtinMuxTemplates`.
- [ ] Use `refs: { rmux_session_name: "{{session_id}}" }`.
- [ ] Implement `create`, `run_in_pane`, `send`, `attach`, `attach_command`, and `close` as specified in `docs/superpowers/specs/2026-06-14-rmux-mux-template-design.md`.
- [ ] Run `bun test packages/runtime/test/builtin-mux.test.ts packages/runtime/test/attach-hint.test.ts packages/runtime/test/builtin-agent.test.ts` and verify pass.
- [ ] Commit implementation.

## Task 3: Update docs/help surfaces

**Files:**
- Modify docs or CLI help files that enumerate builtin mux choices.

- [ ] Search for `herdr`, `tmux`, and `zellij` enumerations.
- [ ] Add `rmux` anywhere builtin mux options are listed.
- [ ] Run docs link/placeholder checks through `bun run check` later; run targeted tests if a touched file has tests.
- [ ] Commit docs/help updates.

## Task 4: Validate, create PR, and merge

**Files:**
- Mikan issue state if updated.

- [ ] Create or update a mikan issue for RMUX support.
- [ ] Run:

```sh
bun test packages/runtime/test/builtin-mux.test.ts packages/runtime/test/attach-hint.test.ts packages/runtime/test/builtin-agent.test.ts
bun run typecheck
bun run check
```

- [ ] Smoke generated config if needed with `bun run asem init --help` or relevant CLI help.
- [ ] Push branch `mik-044-rmux-mux-template`.
- [ ] Open PR with validation evidence.
- [ ] Merge PR after checks/review.
- [ ] Mark mikan issue completed.
- [ ] Pull/clean GitButler workspace and confirm `git status --short` is empty.
