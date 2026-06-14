# Stronger Builtin Agent Profiles Design

## Goal

Strengthen asem builtin Agent Profiles using `nicobailon/pi-subagents` as a reference while preserving asem's Agent Profile boundary: prompt shaping only, no workflow roles, no automatic selection, no task lifecycle semantics, and no builtin launch defaults.

## Current problem

The first builtin profile prompts are intentionally small, but they are too weak to reliably steer child Sessions. They name a specialty but do not consistently state responsibilities, boundaries, working rules, escalation conditions, or output expectations.

`pi-subagents` provides stronger agent prompts with clearer contracts. asem should adopt the useful prompt-shaping parts without copying runtime-specific fields such as tools, output files, inherited context, progress tracking, or supervisor APIs.

## Builtin set

Keep the existing profiles and add the pi-subagents-derived profiles the user requested:

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

All builtin profiles remain instructions-only:

```ts
agent: null
model: null
source: "builtin"
```

## Prompt style

Each builtin profile should include:

1. A clear identity and purpose.
2. Responsibilities.
3. Working rules.
4. Boundaries / non-goals.
5. Escalation or stop conditions when relevant.
6. Final response expectations.

The prompts should be stronger than the initial 2-3 line versions but still portable across Agents. They must not assume a specific tool set, output file path, `contact_supervisor`, pi-subagents runtime, or inherited context mechanism.

## Profile-specific intent

- `scout`: fast local reconnaissance; inspect code/docs; return high-value context, entry points, risks, and open questions; avoid edits unless explicitly asked.
- `planner`: turn requirements and context into an ordered implementation plan; do not implement; surface ambiguity instead of guessing.
- `worker`: execute a bounded approved change with minimal coherent edits; validate and report changed files/checks/risks; escalate unapproved decisions.
- `reviewer`: inspect diffs/plans/solutions/codebase state with evidence; report blockers first; avoid invented issues.
- `debugger`: disciplined reproduce → minimize → hypothesize → instrument → fix → regression-test loop.
- `docs-writer`: update durable docs using project domain language, cross-links, and clear prose; prefer updating existing docs before adding new ones.
- `oracle`: high-context decision-consistency review; challenge assumptions and prevent drift; do not edit by default.
- `context-builder`: gather requirements/code context and produce a compact handoff/meta-prompt; avoid implementation.
- `researcher`: run focused external research with primary sources and citations; separate findings, sources, and gaps.
- `delegate`: lightweight general-purpose helper for direct bounded tasks; stay close to the parent/user request and avoid scope expansion.

## Docs and tests

Update docs and tests that currently say the builtin set is exactly six. Replace that with the 10-profile set above and keep the warning against workflow-shaped names such as `coordinator`, `parent`, and `pr-finisher`.

Tests should assert:

- builtin ids are exactly the 10-profile set;
- each builtin remains source `builtin` with null `agent` and null `model`;
- strengthened prompts include key sections/phrases sufficient to prevent accidental regression to terse prompts.

## Non-goals

- No `role` field.
- No `profile: "auto"` or automatic profile selection.
- No multiple-profile composition.
- No tools/runtime/default output semantics in Agent Profile definitions.
- No coordinator/parent/pr-finisher profile names.
