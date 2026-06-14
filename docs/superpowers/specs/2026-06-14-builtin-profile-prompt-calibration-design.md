# Builtin Agent Profile prompt calibration design

## Context

PR #55 landed stronger builtin Agent Profile instructions for ten profiles:

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

The stronger prompts follow the pi-subagents style: responsibilities, working rules, boundaries, and final response expectations. They remain asem Agent Profiles, not runtime subagents: they are prompt shaping only, with no `agent`/`model` defaults for builtins and no role, workflow, team, task lifecycle, coordinator, or result interpretation semantics.

The current builtin prompts are effective-looking but long: about 1,991 words total, averaging about 199 words per profile. Because profile instructions are prepended to the user's initial prompt, long builtins may dominate short user requests, increase token cost, and encourage verbose output.

## Goal

Calibrate builtin Agent Profile prompt length with evidence before changing shipped instructions.

The desired outcome is a shorter builtin prompt set that preserves useful specialization and boundary discipline while reducing prompt weight and output verbosity.

## Non-goals

- Do not change profile resolution, precedence, file format, or prompt composition.
- Do not add automatic profile selection.
- Do not add builtin `agent` or `model` defaults.
- Do not introduce roles, workflows, teams, task lifecycle states, coordinators, worker pools, scheduling, or success/failure interpretation.
- Do not remove any of the ten agreed builtin profile ids unless a separate design decision revisits the builtin set.

## Variants to compare

### Current variant

Use the PR #55 prompts as the baseline. They average about 199 words per profile and include sections for responsibilities, working rules, boundaries, and final response.

### Medium variant

Draft each profile as a compact behavior card, around 100-130 words per profile. Use this structure where possible:

```md
You are the <id> profile.

Mission:
- ...

Do:
- ...

Do not:
- ...

Output:
- ...
```

This is the expected candidate for shipping if evaluation shows it preserves behavior.

### Short variant

Draft each profile as a minimal behavior card, around 60-90 words per profile. Keep only mission, key constraints, and output shape.

This variant tests how much prompt can be removed before specialization becomes too weak.

## Evaluation profiles and tasks

Evaluate at least these four profiles because they cover the main risk surfaces:

| Profile | Task shape | What to observe |
| --- | --- | --- |
| `scout` | Inspect a focused area of code/docs and report relevant context. | Concrete file references, useful scope control, no premature implementation. |
| `reviewer` | Review a small diff against a stated requirement. | Findings quality, severity discipline, evidence, no false approval. |
| `debugger` | Diagnose a failing test or described bug. | Reproduce/minimize/hypothesis discipline, avoids guess-first fixes. |
| `planner` | Turn a bounded goal into an implementation plan. | Specific ordered tasks, validation, open questions, no hidden product decisions. |

Optional follow-up samples may cover `worker`, `researcher`, and `context-builder` because they exercise implementation, external evidence, and context-packaging behavior. They are not required before choosing a prompt budget unless the four required profiles produce mixed results.

## Evaluation criteria

Score each run qualitatively against these criteria:

1. **Instruction adherence** — follows the selected profile's intended behavior.
2. **Specificity** — cites concrete files, commands, evidence, or assumptions where appropriate.
3. **Brevity** — avoids profile-induced verbosity and boilerplate.
4. **Boundary safety** — does not introduce workflow, role, lifecycle, coordinator, or result semantics.
5. **User-prompt sensitivity** — follows the user's actual request instead of over-indexing on profile text.
6. **Actionability** — output helps the caller take the next step.
7. **Prompt weight** — compare approximate word/character counts for each variant.

Adopt a shorter variant only if it keeps boundary safety and actionability close to the current variant while improving brevity and prompt weight.

## Implementation approach after evaluation

If the Medium variant performs best, replace the builtin instructions in `packages/profiles/src/builtin.ts` with Medium prompts.

If the Short variant performs best, use Short prompts only if reviewer/debugger/planner still produce concrete, safe, actionable output. If Short weakens those profiles, keep Medium.

If Current clearly outperforms both shorter variants, keep Current and document why the length is justified.

## Tests

Maintain or add tests for:

- the builtin ids are exactly the ten agreed ids;
- builtin profiles remain instructions-only (`agent === null`, `model === null`);
- builtins do not contain forbidden orchestration/lifecycle terms in a semantics-bearing way;
- builtin prompts stay under the chosen maximum word or character budget, if a shorter variant is adopted;
- CLI/ops profile list/get behavior remains unchanged.

## Rollout

This is a low-risk prompt-only change. Existing Sessions keep their already-written `prompt.md`; new Sessions receive the updated builtin prompt text when the selected profile resolves from `builtin`.

## Open decision

The evaluation decides the prompt budget. Initial recommendation: adopt Medium with a soft target of 100-130 words per profile and a hard test cap that leaves enough room for small future edits without drifting back to the 200-word average.
