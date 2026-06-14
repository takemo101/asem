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
