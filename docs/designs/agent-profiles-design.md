# Agent Profiles Design

Agent Profiles are explicit prompt-shaping bundles for new Sessions. They let a caller ask an Agent to behave like a scout, reviewer, debugger, or other bounded specialty without adding workflow roles, teams, task states, automatic scheduling, or result interpretation to asem.

See also [ADR 0007](../adr/0007-agent-profiles-are-explicit-prompt-shaping.md).

## Goals

- Let callers explicitly select one Agent Profile when creating a Session.
- Apply the selected profile to the initial prompt for every Agent Template prompt delivery mode, including `paste_prompt`.
- Support builtin profiles plus user and project profile files.
- Keep profile behavior local and inspectable through CLI/MCP list/get surfaces.
- Persist which profile was used for a Session without storing a second copy of the profile instructions in SQLite.

## Non-goals

- No workflow roles, positions, teams, strategies, coordinators, worker pools, or task lifecycle semantics.
- No automatic profile selection from prompt content.
- No profile composition, inheritance, merging, or ordered profile stacks.
- No hidden default profile in `.asem.yaml` for MVP.
- No Agent-specific model validation, model discovery, or provider routing.

## Domain model

An **Agent Profile** is a named bundle of behavior instructions applied to a new Session's initial prompt. A profile may optionally carry launch defaults (`agent`, `model`) for user/project profiles, but these are defaults only: explicit create-session inputs always win, and a profile never decides whether work succeeded.

A Session stores the selected profile id and resolved source:

```ts
profile: string | null;
profileSource: "project" | "user" | "builtin" | null;
```

The Session does not store profile instructions in SQLite. The effective prompt written to `prompt.md` contains the resolved profile instructions and the caller's original prompt.

## Profile sources and precedence

Profiles are resolved from three sources:

1. project profiles under `<worktree_root>/.asem/agents/*.md`;
2. user profiles under `~/.asem/agents/*.md`;
3. builtin profiles packaged with asem.

Resolution precedence is:

```text
project > user > builtin
```

If the same profile id appears in more than one source, the highest-priority source replaces the lower source completely. There is no merge or append behavior. If the same source contains the same profile id more than once, profile discovery fails with `invalid_config` and reports the conflicting paths.

Project profiles are intentionally stored under `.asem/agents/`, which is not covered by asem's runtime-state ignore rules. Runtime token-bearing paths remain ignored (`.asem/sessions/`, `.asem/current-session*.json`, `.asem/tokens/`).

## Profile file format

User and project profiles are Markdown files with YAML frontmatter:

```md
---
id: reviewer
description: Review code against the requested spec and repo standards.
agent: claude
model: sonnet
---

You review changes for correctness, maintainability, and alignment with the user's request.
Report concrete blockers first, then smaller recommendations.
```

Rules:

- `id` is required and must be non-empty.
- The Markdown body is required and must be non-empty after trimming.
- `description` is optional and used by list surfaces.
- `agent` is optional and acts as a create-session default.
- `model` is optional and acts as a create-session default only when it is compatible with the resolved Agent default rules below.
- Unknown frontmatter fields are rejected in MVP so profile files stay small and intentional.

Builtin profiles use the same parsed shape, but the initial builtin set is instructions-only and does not carry `agent` or `model` defaults.

## Builtin profiles

Initial builtin ids:

- `scout` — inspect code/docs and report findings without changing files unless asked.
- `planner` — turn a goal into implementation steps, risks, and validation checks.
- `worker` — implement a bounded change and report changed files/checks.
- `reviewer` — review work against the user request, docs, tests, and repo standards.
- `debugger` — reproduce, minimize, hypothesize, instrument, fix, and regression-test a bug.
- `docs-writer` — update durable docs with clear domain language and cross-links.

Do not add `coordinator`, `parent`, `pr-finisher`, or similar workflow-shaped builtin profiles without a new design discussion. Those names imply orchestration or lifecycle authority, which is outside Agent Profile responsibility.

## Create Session resolution

`create_session` accepts optional `profile`.

Launch field precedence:

```text
explicit input > selected profile default > project config default
```

For `agent`:

1. use explicit `agent` input when present;
2. else use selected profile `agent` when present;
3. else use `.asem.yaml` `agent.default`.

For `model`:

1. use explicit `model` input when present;
2. else use selected profile `model` only when it is safe for the resolved Agent;
3. else use no model.

If an explicit `agent` differs from the selected profile's default `agent`, the selected profile's default `model` is suppressed. This avoids applying a Claude-oriented model default to a different Agent such as `pi` or `agy`. The profile instructions still apply.

If the final resolved Agent Template does not support models and the final resolved model is non-null, `create_session` fails with `invalid_input` before filesystem, mux, or store side effects.

Unknown requested profile ids fail with `invalid_input`. Malformed profile files, duplicate ids within a source, or invalid profile frontmatter fail with `invalid_config`.

## Prompt composition

When a profile is selected, `@asem/profiles` renders an effective prompt with profile instructions first and user prompt second:

```md
# Agent Profile

Profile: reviewer
Source: project

<profile instructions>

# User Prompt

<original user prompt>
```

`prompt.md` stores this effective prompt. There is no separate `raw-prompt.md`; the original user prompt remains available under the `# User Prompt` section.

The same effective prompt is used for all Agent Template prompt delivery modes:

- `{{prompt_shell}}` and `{{prompt_path_shell}}` read the effective `prompt.md`;
- `paste_prompt: true` sends the effective prompt through the mux `send` sequence.

## CLI and MCP surfaces

Session creation:

```sh
asem session create review-1 --profile reviewer --prompt "Review the current diff"
```

MCP `create_session` accepts:

```json
{ "name": "review-1", "profile": "reviewer", "prompt": "Review the current diff" }
```

Discovery surfaces:

- `asem profile list` shows `id`, `source`, `description`, `agent`, and `model`.
- `asem profile get <id>` shows the same metadata plus full instructions.
- MCP exposes equivalent list/get profile tools.

The selected `profile` and `profileSource` are included in Session JSON/detail projections and in TUI Session details when present.

## Package architecture

Add `@asem/profiles`:

| Package | Responsibility |
|---|---|
| `@asem/profiles` | builtin profile definitions, user/project profile discovery, Markdown/frontmatter parsing, source precedence, profile resolution, prompt rendering |

`@asem/ops` calls `@asem/profiles` from `create_session`, passing the resolved worktree root and home/user profile root through injected dependencies where needed. `@asem/ops` owns create-session semantics and side-effect ordering; `@asem/profiles` owns profile-specific parsing/resolution/rendering.

`@asem/core` owns shared profile-related types in operation and Session schemas (`profile`, `profileSource`) but does not read files or parse Markdown.

## Trust model

Profiles are trusted local prompt material. They do not execute shell commands, but they do shape Agent behavior. Project profiles are shared project files and should be reviewed like other behavior-affecting project configuration. Profiles apply only when explicitly selected with `--profile` / MCP `profile`; MVP has no hidden default profile and no automatic selection.

## Testing expectations

- Profile parser tests cover required `id`, required body, optional metadata, unknown frontmatter rejection, and malformed frontmatter.
- Resolver tests cover project > user > builtin precedence, complete replacement, duplicate ids within a source, and unknown requested ids.
- Prompt rendering tests cover profile-first composition and exact preservation of the user prompt under `# User Prompt`.
- `create_session` tests cover explicit/profile/config precedence, model suppression when explicit agent differs from profile agent, model-unsupported failure before side effects, `paste_prompt` using the effective prompt, and Session persistence of `profile`/`profileSource`.
- CLI/MCP tests cover parse/schema pass-through and list/get profile surfaces.
- Store migration/row tests cover nullable `profile` and `profile_source` columns for existing Sessions.
