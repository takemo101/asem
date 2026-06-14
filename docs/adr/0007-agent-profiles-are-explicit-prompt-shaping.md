# ADR 0007: Agent Profiles are explicit prompt shaping, not roles

## Status

Accepted, 2026-06-14.

## Context

asem is a local agent Session manager. Its scope guard intentionally excludes task lifecycle states, teams, coordinators, strategies, worker pools, scheduling, and result interpretation. `CONTEXT.md` also says that “Role” is intentionally not part of the MVP.

The next specialization feature needs to let callers start a Session with focused behavior such as scout, planner, reviewer, debugger, or docs writer. cuekit has an Agent Profile system, but cuekit also exposes profile-like behavior through a `role` field and supports automatic role selection. Copying that shape directly into asem would blur the product boundary: a profile could start to mean a workflow role, a team position, or an outcome-bearing task assignment.

At the same time, prompt specialization is useful and fits asem if it stays explicit and local to Session creation.

## Decision

asem Agent Profiles are named prompt-shaping bundles applied only when a caller explicitly selects one for `create_session`.

A profile may provide:

- behavior instructions added to the Session's initial prompt;
- optional launch defaults such as Agent or model for user/project profiles.

A profile must not provide:

- workflow role or position semantics;
- automatic profile selection;
- task lifecycle or result interpretation;
- scheduling, coordination, worker-pool, or team behavior;
- durable completion/failure meaning.

The first design uses a single explicit `profile` field rather than `role`, `profiles`, or `auto`. Session specialization remains expressed through Session names, prompts, Agent Profiles, and Agent Templates.

Detailed mechanics are specified in [Agent Profiles Design](../designs/agent-profiles-design.md).

## Consequences

- Callers get reusable prompt specialization without turning asem into a workflow/task orchestrator.
- The CLI/MCP surface stays explicit: no hidden default profile and no `auto` selection in MVP.
- Future contributors have a durable reason not to add cuekit-style roles, coordinators, or profile auto-selection under the Agent Profile feature.
- User/project profiles may still influence launch defaults, so docs and UI must make the selected profile id/source visible on a Session.

## Rejected alternatives

### Use `role` as the public field

Rejected because `role` conflicts with the asem glossary and suggests workflow position or task authority rather than prompt shaping.

### Support `profile: "auto"`

Rejected because automatic profile selection adds hidden decision logic and moves asem toward task/workflow orchestration. A caller can still choose a profile explicitly.

### Support multiple profiles in MVP

Rejected for the first slice because ordered composition requires conflict rules, prompt ordering rules, and likely merge semantics. A single explicit profile covers the immediate specialization need with a smaller API.

### Treat Agent Profiles as Agent Templates

Rejected because Agent Templates own process invocation and prompt delivery mechanics, while Agent Profiles own behavior instructions. Mixing them would blur Template responsibility and make prompt shaping harder to inspect independently.
