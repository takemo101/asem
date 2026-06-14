# Builtin Profile Prompt Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare current/medium/short builtin Agent Profile prompts, then ship the shortest prompt set that preserves profile usefulness and asem's prompt-only boundaries.

**Architecture:** Keep all runtime semantics unchanged. Evaluation is done with temporary profile variants and recorded evidence; implementation, if justified, only changes `@asem/profiles` builtin prompt text plus tests that guard ids, instruction-only semantics, forbidden orchestration language, and prompt budget drift.

**Tech Stack:** Bun test runner, TypeScript, `@asem/profiles`, mikan Issues, GitButler `but`, optional dogfood `asem session create --profile ...` Sessions.

---

## Files and responsibilities

- `docs/superpowers/specs/2026-06-14-builtin-profile-prompt-calibration-design.md` — approved design input; do not rewrite except for small corrections discovered during implementation.
- `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md` — create; records current/medium/short prompt lengths, dogfood/evaluation notes, and final variant decision.
- `packages/profiles/src/builtin.ts` — modify only after evaluation; contains shipped builtin profile descriptions/instructions.
- `packages/profiles/test/resolve.test.ts` — modify; updates builtin prompt shape assertions and adds budget/forbidden-semantics guard tests.
- `packages/ops/test/profiles.test.ts` — keep unchanged unless targeted tests show profile list/get expectations must be updated for the chosen prompt shape.
- `.mikan/` issue state — create/update a `MIK-043` Issue for traceability, using mikan tools or CLI, not direct file edits unless mikan tooling is unavailable.

## Important constraints

- Builtin profiles remain instructions-only: `agent === null`, `model === null`.
- Keep exactly these builtin ids: `context-builder`, `debugger`, `delegate`, `docs-writer`, `oracle`, `planner`, `researcher`, `reviewer`, `scout`, `worker`.
- Do not add runtime fields, tool allowlists, output-file semantics, inherited context, progress tracking, scheduling, workflow roles, task lifecycle states, coordinator authority, or result interpretation.
- Use GitButler for normal VCS mutations in the main workspace. If GitButler remains internally inconsistent, create a clean temporary clone/worktree, apply the patch there, run checks, push a PR branch, and document why.

---

### Task 1: Create tracking Issue and baseline evidence report

**Files:**
- Create: `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md`
- Mikan: create/update `MIK-043` or the next available Issue

- [ ] **Step 1: Create or update the mikan Issue**

Use mikan tooling to create a new Issue if one does not already exist:

```json
{
  "title": "Calibrate builtin Agent Profile prompt length",
  "body": "Compare current/medium/short builtin Agent Profile prompts, then ship the shortest variant that preserves useful behavior and prompt-only boundaries. Spec: docs/superpowers/specs/2026-06-14-builtin-profile-prompt-calibration-design.md"
}
```

Expected: an Issue such as `MIK-043` exists and is active/ready for this work.

- [ ] **Step 2: Generate baseline prompt metrics**

Run:

```bash
bun -e 'import { BUILTIN_PROFILES } from "./packages/profiles/src/index.ts";
const rows = BUILTIN_PROFILES.map((p) => ({ id: p.id, words: p.instructions.split(/\s+/).filter(Boolean).length, chars: p.instructions.length }));
console.log(JSON.stringify({ totalWords: rows.reduce((a, r) => a + r.words, 0), averageWords: Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length), rows }, null, 2));'
```

Expected: current prompts average around 199 words/profile.

- [ ] **Step 3: Create the evidence report skeleton**

Run this command. It writes the report and embeds the current metrics from Step 2 directly, so there is no placeholder content in the file.

```bash
mkdir -p docs/superpowers/reports
METRICS_JSON=$(bun -e 'import { BUILTIN_PROFILES } from "./packages/profiles/src/index.ts";
const rows = BUILTIN_PROFILES.map((p) => ({ id: p.id, words: p.instructions.split(/\\s+/).filter(Boolean).length, chars: p.instructions.length }));
console.log(JSON.stringify({ totalWords: rows.reduce((a, r) => a + r.words, 0), averageWords: Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length), rows }, null, 2));')
cat > docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md <<EOF
# Builtin Agent Profile Prompt Calibration Report

## Goal

Compare current, medium, and short builtin Agent Profile prompts before changing shipped builtin instructions.

## Baseline metrics

\`\`\`json
${METRICS_JSON}
\`\`\`

## Variants

| Variant | Target length | Notes |
| --- | ---: | --- |
| Current | ~199 words/profile | PR #55 baseline. |
| Medium | 100-130 words/profile | Candidate for shipping. |
| Short | 60-90 words/profile | Minimal behavior card. |

## Required evaluation profiles

- \`scout\`
- \`reviewer\`
- \`debugger\`
- \`planner\`

## Evaluation notes

### scout

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Pending evaluation. | Pending. |
| Medium | Pending evaluation. | Pending. |
| Short | Pending evaluation. | Pending. |

### reviewer

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Pending evaluation. | Pending. |
| Medium | Pending evaluation. | Pending. |
| Short | Pending evaluation. | Pending. |

### debugger

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Pending evaluation. | Pending. |
| Medium | Pending evaluation. | Pending. |
| Short | Pending evaluation. | Pending. |

### planner

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Pending evaluation. | Pending. |
| Medium | Pending evaluation. | Pending. |
| Short | Pending evaluation. | Pending. |

## Decision

Pending evaluation.
EOF
```

Expected: `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md` exists with embedded baseline metrics and explicit pending evaluation rows.

- [ ] **Step 4: Commit report skeleton**

Run:

```bash
but status -fv
but commit mik-043-profile-prompt-calibration --create -m "Start builtin profile prompt calibration evidence"
```

Expected: commit contains only the report skeleton and mikan Issue state if mikan stores local Issue files.

---

### Task 2: Draft Medium and Short prompt variants outside shipped code

**Files:**
- Modify: `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md`
- Temporary only: `/tmp/asem-profile-calibration/medium/*.md`
- Temporary only: `/tmp/asem-profile-calibration/short/*.md`

- [ ] **Step 1: Create temporary variant directories**

Run:

```bash
rm -rf /tmp/asem-profile-calibration
mkdir -p /tmp/asem-profile-calibration/medium /tmp/asem-profile-calibration/short
```

Expected: two empty directories exist outside the repo.

- [ ] **Step 2: Draft Medium prompts**

Create one Markdown file per builtin id under `/tmp/asem-profile-calibration/medium/`. Each file body uses four explicit sections: a one-bullet `Mission`, a `Do` section with two to four concrete behaviors, a `Do not` section with two to three hard boundaries, and an `Output` section with two to four bullets. The `reviewer` example below is the exact style and density to use for every profile.

For `/tmp/asem-profile-calibration/medium/reviewer.md`:

```markdown
You are the reviewer profile.

Mission:
- Find correctness, design, security, test, and requirement gaps in a bounded change.

Do:
- Compare the change against the user's stated scope and repository standards.
- Cite concrete files, lines, commands, or observed behavior.
- Separate blocking defects from suggestions and questions.

Do not:
- Rewrite code unless explicitly asked.
- Approve incomplete, untested, or unverifiable work.
- Introduce workflow, task lifecycle, coordinator, or success/failure semantics.

Output:
- Verdict: APPROVE, APPROVE WITH NOTES, or BLOCK.
- Findings by severity with evidence.
- Required fixes and validation evidence.
```

Expected: each Medium prompt is about 100-130 words, with the same profile-specific intent as the current builtin.

- [ ] **Step 3: Draft Short prompts**

Create one Markdown file per builtin id under `/tmp/asem-profile-calibration/short/`. Each file body is one compact behavior card: one opening mission sentence, one `Do:` sentence, one `Do not:` sentence, and one `Output:` sentence. The `reviewer` example below is the exact style and density to use for every profile.

For `/tmp/asem-profile-calibration/short/reviewer.md`:

```markdown
You are the reviewer profile. Find correctness, design, security, test, and requirement gaps in a bounded change.

Do: compare against the stated scope, cite concrete evidence, and separate blockers from suggestions.

Do not: rewrite code unless asked, approve unverifiable work, or introduce workflow/task lifecycle semantics.

Output: verdict, findings by severity, required fixes, and validation evidence.
```

Expected: each Short prompt is about 60-90 words.

- [ ] **Step 4: Record variant metrics**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
for (const variant of ['medium', 'short']) {
  const dir = `/tmp/asem-profile-calibration/${variant}`;
  const rows = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((file) => {
    const text = fs.readFileSync(`${dir}/${file}`, 'utf8').trim();
    return { id: file.replace(/\.md$/, ''), words: text.split(/\s+/).filter(Boolean).length, chars: text.length };
  }).sort((a, b) => a.id.localeCompare(b.id));
  console.log(JSON.stringify({ variant, totalWords: rows.reduce((a, r) => a + r.words, 0), averageWords: Math.round(rows.reduce((a, r) => a + r.words, 0) / rows.length), rows }, null, 2));
}
NODE
```

Expected: Medium average is 100-130 words; Short average is 60-90 words.

- [ ] **Step 5: Append variant metrics to the report**

Add a `## Variant metrics` section to the report with the Step 4 JSON output.

- [ ] **Step 6: Commit variant evidence**

Run:

```bash
but status -fv
but commit mik-043-profile-prompt-calibration -m "Record builtin profile prompt variants"
```

Expected: commit contains only report updates. Temporary `/tmp` prompt drafts are not committed.

---

### Task 3: Evaluate variants with dogfood Sessions or equivalent transcript prompts

**Files:**
- Modify: `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md`

- [ ] **Step 1: Prepare four evaluation tasks**

Use these exact tasks:

```markdown
## scout task
Inspect `packages/profiles/src/builtin.ts` and `packages/profiles/test/resolve.test.ts`. Report what behavior is covered by tests and where prompt length drift could be guarded.

## reviewer task
Review the diff that would add a max word budget test to `packages/profiles/test/resolve.test.ts`. Find correctness, maintainability, and false-positive risks.

## debugger task
Assume a test named `builtin profiles stay under prompt budget` fails because `context-builder` has 152 words. Diagnose the likely cause and propose the smallest safe fix.

## planner task
Plan the implementation for replacing current builtin Agent Profile prompts with the Medium variant while preserving profile ids, instructions-only semantics, and CLI/MCP behavior.
```

- [ ] **Step 2: Run Current variant samples**

For each required profile, create an asem Session using the current builtin profile and the matching task. Example:

```bash
bun run asem session create calibration-reviewer-current --profile reviewer --prompt "Review the diff that would add a max word budget test to packages/profiles/test/resolve.test.ts. Find correctness, maintainability, and false-positive risks." --json
```

Expected: each Session starts and eventually reports or can be inspected. Close Sessions after collecting output; do not delete them if message/report history is needed.

- [ ] **Step 3: Run Medium and Short variant samples**

Use either of these safe approaches:

1. Preferred: create a temporary clone or worktree, add project profile overrides under `.asem/agents/*.md`, and run commands such as `asem session create calibration-reviewer-medium --profile reviewer --prompt "Review the diff that would add a max word budget test to packages/profiles/test/resolve.test.ts. Find correctness, maintainability, and false-positive risks."` there.
2. Alternative: prepend the variant prompt text manually to the task prompt in a normal Session and clearly label the transcript as simulated profile behavior.

Expected: Medium/Short outputs are comparable to Current outputs for the same four tasks.

- [ ] **Step 4: Score each sample**

For each profile/variant, append 2-4 bullets to the report covering:

```markdown
- Instruction adherence:
- Specificity:
- Brevity:
- Boundary safety:
- User-prompt sensitivity:
- Actionability:
- Decision:
```

Expected: report contains enough evidence to justify Current, Medium, or Short.

- [ ] **Step 5: Choose the variant**

Compute reduction percentage with `Math.round((1 - selectedTotalWords / currentTotalWords) * 100)`, using the metrics recorded in the report. Then update the report `## Decision` section with one paragraph that includes:

- the selected variant: Current, Medium, or Short;
- the computed prompt-weight reduction percentage, unless Current is kept;
- the strongest concrete observation from the required `scout`, `reviewer`, `debugger`, or `planner` samples;
- if Current is kept, the concrete samples where Medium or Short weakened behavior.

- [ ] **Step 6: Commit evaluation report**

Run:

```bash
but status -fv
but commit mik-043-profile-prompt-calibration -m "Evaluate builtin profile prompt variants"
```

Expected: commit contains the completed report only.

---

### Task 4: Add prompt budget and forbidden-semantics tests

**Files:**
- Modify: `packages/profiles/test/resolve.test.ts`

- [ ] **Step 1: Write the failing budget/semantics tests**

Add these tests inside `describe("builtin profiles", () => { ... })` after the existing two builtin tests. If the selected variant is Medium, set `MAX_WORDS_PER_BUILTIN_PROFILE` to `140`. If the selected variant is Short, set it to `95`. If Current is kept, skip the budget test and only add the forbidden semantics test.

```ts
const MAX_WORDS_PER_BUILTIN_PROFILE = 140;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const FORBIDDEN_BUILTIN_PROFILE_TERMS = [
  /\bcoordinator\b/i,
  /\bworker pool\b/i,
  /\btask lifecycle\b/i,
  /\bcompleted\/failed\/blocked\b/i,
  /\bauto[- ]?select/i,
  /\bscheduler\b/i,
  /\bsuccess\/failure\b/i,
];

test("stay within the selected prompt budget", () => {
  for (const profile of BUILTIN_PROFILES) {
    expect(wordCount(profile.instructions), profile.id).toBeLessThanOrEqual(
      MAX_WORDS_PER_BUILTIN_PROFILE,
    );
  }
});

test("avoid workflow and lifecycle semantics", () => {
  for (const profile of BUILTIN_PROFILES) {
    for (const forbidden of FORBIDDEN_BUILTIN_PROFILE_TERMS) {
      expect(profile.instructions, profile.id).not.toMatch(forbidden);
    }
  }
});
```

Expected before changing `builtin.ts`: budget test fails for Current prompts if Medium/Short is selected.

- [ ] **Step 2: Run the targeted test and verify failure**

Run:

```bash
bun test packages/profiles/test/resolve.test.ts
```

Expected if Medium/Short selected: FAIL on `stay within the selected prompt budget` for one or more current profiles. The forbidden semantics test may also fail if current prompts contain exact forbidden terms; adjust forbidden regex only if it is flagging boundary text that is intentionally negative, then prefer changing prompt wording to avoid the term.

- [ ] **Step 3: Commit failing tests only**

Run:

```bash
but status -fv
but commit mik-043-profile-prompt-calibration -m "Test builtin profile prompt budget"
```

Expected: commit contains only `packages/profiles/test/resolve.test.ts` changes.

---

### Task 5: Replace builtin prompts with the selected variant

**Files:**
- Modify: `packages/profiles/src/builtin.ts`
- Modify: `packages/profiles/test/resolve.test.ts`

- [ ] **Step 1: Update `builtin.ts` prompt comment**

Keep the comment's semantic boundary, but update length language to match the decision. Use this shape:

```ts
/**
 * Builtin profiles, keyed by id. They are sorted by the resolver for display.
 * The prompts use compact behavior-card contracts inspired by pi-subagents, but
 * omit runtime-specific fields such as tool allowlists, output filenames,
 * inherited context, or supervisor APIs because asem Agent Profiles are prompt
 * shaping only.
 */
```

- [ ] **Step 2: Replace each selected prompt**

For each `builtin(id, description, instructions)` call, replace only the template-string body with the selected variant. Preserve the id and keep `agent`/`model` null through the helper.

Example for Medium `reviewer`:

```ts
  builtin(
    "reviewer",
    "Review a bounded change for correctness, design fit, tests, and requirement alignment.",
    `You are the reviewer profile.

Mission:
- Find correctness, design, security, test, and requirement gaps in a bounded change.

Do:
- Compare the change against the user's stated scope and repository standards.
- Cite concrete files, lines, commands, or observed behavior.
- Separate blocking defects from suggestions and questions.

Do not:
- Rewrite code unless explicitly asked.
- Approve incomplete, untested, or unverifiable work.
- Introduce workflow, lifecycle, coordinator, or result semantics.

Output:
- Verdict: APPROVE, APPROVE WITH NOTES, or BLOCK.
- Findings by severity with evidence.
- Required fixes and validation evidence.`,
  ),
```

Expected: all selected prompts satisfy the budget test and still express mission, behaviors, boundaries, and output shape.

- [ ] **Step 3: Update older shape-specific assertions**

Replace the current assertions for `## Working rules` and `## Final response` with structure-appropriate checks:

```ts
expect(profile.instructions).toContain("Mission:");
expect(profile.instructions).toContain("Do:");
expect(profile.instructions).toContain("Do not:");
expect(profile.instructions).toContain("Output:");
```

Expected: tests assert the new behavior-card shape, not the old long-section headings.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
bun test packages/profiles/test/resolve.test.ts packages/ops/test/profiles.test.ts
```

Expected: 21+ tests pass, 0 fail.

- [ ] **Step 5: Commit implementation**

Run:

```bash
but status -fv
but commit mik-043-profile-prompt-calibration -m "Calibrate builtin profile prompts"
```

Expected: commit contains `packages/profiles/src/builtin.ts` and any necessary test updates.

---

### Task 6: Validate, update Issue, and open PR

**Files:**
- Mikan Issue state only, if updated
- No code changes unless validation reveals a defect

- [ ] **Step 1: Run full validation**

Run:

```bash
bun test packages/profiles/test/resolve.test.ts packages/ops/test/profiles.test.ts
bun run typecheck
bun run check
```

Expected:

```text
Targeted tests: pass
Typecheck: pass
Check: pass, with existing integration skips only
```

- [ ] **Step 2: Smoke profile output**

Run:

```bash
bun run asem profile list
bun run asem profile get reviewer
```

Expected: list shows the ten builtin ids; `reviewer` shows the selected shorter prompt and no agent/model defaults.

- [ ] **Step 3: Append final mikan report**

Append a final report to the Issue Reports section. The report must name the selected variant, link the evidence report, and list validation commands. Use this exact structure after replacing the first sentence with the concrete selected variant from the evaluation report:

```markdown
Implemented builtin Agent Profile prompt calibration and selected the Medium variant.

Evidence:
- Report: docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md
- Targeted tests: `bun test packages/profiles/test/resolve.test.ts packages/ops/test/profiles.test.ts`
- Typecheck: `bun run typecheck`
- Check: `bun run check`
- Smoke: `bun run asem profile list`, `bun run asem profile get reviewer`
```

- [ ] **Step 4: Push/open PR**

Use GitButler first:

```bash
but push mik-043-profile-prompt-calibration
```

Then create a PR body that names the selected variant from the evidence report. If Medium is selected, use this body exactly:

```markdown
## Summary

- Compare current/medium/short builtin Agent Profile prompt variants.
- Adopt Medium based on recorded evidence.
- Add tests guarding builtin prompt budget and prompt-only boundaries.

## Evidence

See `docs/superpowers/reports/2026-06-14-builtin-profile-prompt-calibration.md`.

## Validation

- `bun test packages/profiles/test/resolve.test.ts packages/ops/test/profiles.test.ts`
- `bun run typecheck`
- `bun run check`
- `bun run asem profile list`
- `bun run asem profile get reviewer`
```

If Short or Current is selected, change only the second Summary bullet to name that selected variant.

Expected: PR diff includes the report, tests, prompt changes if any, and mikan Issue state if tracked.

- [ ] **Step 5: Merge after review**

After PR checks/review pass, merge. If a reviewer Session is used, close it after preserving Reports/Messages.

Expected: main branch has calibrated builtin profile prompts and evidence.
