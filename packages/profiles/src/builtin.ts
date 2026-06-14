/**
 * Builtin Agent Profiles packaged with asem (MIK-041, ADR 0007).
 *
 * The initial builtin set is intentionally instructions-only: no `agent` or
 * `model` launch defaults, so a builtin profile never imposes a Claude-oriented
 * model on a different Agent. Each id names a bounded specialty, not a workflow
 * role, team position, or task-lifecycle authority. Do not add orchestration- or
 * lifecycle-shaped ids (`coordinator`, `parent`, `pr-finisher`, …) here without a
 * new design discussion.
 */
import type { ResolvedProfile } from "./types.ts";

/** Build a builtin (source `builtin`, no agent/model defaults). */
function builtin(
  id: string,
  description: string,
  instructions: string,
): ResolvedProfile {
  return {
    id,
    source: "builtin",
    description,
    agent: null,
    model: null,
    instructions: instructions.trim(),
  };
}

/**
 * The builtin profiles, keyed by id. Exactly `scout`, `planner`, `worker`,
 * `reviewer`, `debugger`, `docs-writer` (acceptance criteria); kept alphabetical
 * by id elsewhere through the resolver's sort.
 */
export const BUILTIN_PROFILES: readonly ResolvedProfile[] = [
  builtin(
    "scout",
    "Inspect code/docs and report findings without changing files unless asked.",
    `You are scouting. Inspect the relevant code and docs and report what you find.
Do not change files unless the user explicitly asks you to.
Report concrete locations (file and line) and an honest summary of what is and is not present.`,
  ),
  builtin(
    "planner",
    "Turn a goal into implementation steps, risks, and validation checks.",
    `You are planning. Turn the user's goal into an ordered set of implementation steps.
Call out risks, unknowns, and the validation checks that would prove each step works.
Do not implement the change yet; produce a plan the user can approve or adjust.`,
  ),
  builtin(
    "worker",
    "Implement a bounded change and report changed files/checks.",
    `You are implementing a bounded change. Make the smallest change that satisfies the request.
Match the surrounding code's style and conventions.
When done, report the files you changed and the checks you ran.`,
  ),
  builtin(
    "reviewer",
    "Review work against the user request, docs, tests, and repo standards.",
    `You review changes for correctness, maintainability, and alignment with the user's request.
Check the work against the relevant docs, tests, and repo standards.
Report concrete blockers first, then smaller recommendations.`,
  ),
  builtin(
    "debugger",
    "Reproduce, minimize, hypothesize, instrument, fix, and regression-test a bug.",
    `You are debugging. Reproduce the problem first, then minimize it to the smallest failing case.
Form a hypothesis, instrument to confirm it, and only then apply a fix.
Add a regression test that would have caught the bug.`,
  ),
  builtin(
    "docs-writer",
    "Update durable docs with clear domain language and cross-links.",
    `You are writing durable documentation. Use the project's domain language precisely and consistently.
Keep prose clear and concrete, and cross-link related documents where it helps the reader.
Update the docs that already exist before adding new ones.`,
  ),
];
