# Builtin Agent Profile Prompt Calibration Report

## Goal

Compare current, medium, and short builtin Agent Profile prompts before changing shipped builtin instructions.

## Baseline metrics

```json
{
  "totalWords": 1991,
  "averageWords": 199,
  "rows": [
    {
      "id": "scout",
      "words": 201,
      "chars": 1268
    },
    {
      "id": "planner",
      "words": 211,
      "chars": 1326
    },
    {
      "id": "worker",
      "words": 202,
      "chars": 1300
    },
    {
      "id": "reviewer",
      "words": 218,
      "chars": 1390
    },
    {
      "id": "debugger",
      "words": 193,
      "chars": 1210
    },
    {
      "id": "docs-writer",
      "words": 192,
      "chars": 1190
    },
    {
      "id": "oracle",
      "words": 200,
      "chars": 1317
    },
    {
      "id": "context-builder",
      "words": 205,
      "chars": 1310
    },
    {
      "id": "researcher",
      "words": 193,
      "chars": 1217
    },
    {
      "id": "delegate",
      "words": 176,
      "chars": 1033
    }
  ]
}
```

## Variants

| Variant | Target length | Notes |
| --- | ---: | --- |
| Current | ~199 words/profile | PR #55 baseline. |
| Medium | 100-130 words/profile | Candidate for shipping. |
| Short | 60-90 words/profile | Minimal behavior card. |

## Required evaluation profiles

- `scout`
- `reviewer`
- `debugger`
- `planner`

## Evaluation notes

### scout

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Strongest specificity: files, entry points, data flow, line citations, no edits, ambiguity handling. Downside: 201 words and a more prescriptive final format. | Useful but heavier than needed. |
| Medium | Keeps inspect-first behavior, targeted search, files/data flow/constraints, verified facts vs hypotheses, no edits, and no completion authority. Much lower weight while staying actionable. | Preferred. |
| Short | Safest on weight and still evidence-based, but loses useful specificity such as entry points, likely change locations, and richer next-step guidance. | Too compressed. |

### reviewer

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Strongest evidence discipline and project-fit reminders, including tests and repository standards. Downside: 218 words and a rigid response structure. | Useful but too heavy. |
| Medium | Keeps bounded-change review, repository standards, concrete evidence, severity separation, no rewrite, and no lifecycle/final-outcome authority. Verdict format remains actionable without adding workflow semantics. | Preferred. |
| Short | Concise and safe, but less protective: drops durable-docs nuance, edge-case cautions, and explicit clean-review behavior. | Too compressed. |

### debugger

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Excellent method: reproduce, minimize, hypothesize, test, regression checks, cleanup instrumentation. Downside: 193 words and more implementation-heavy wording by default. | Useful but heavier than needed. |
| Medium | Best prompt-shaping fit: diagnose from evidence, restate expected/observed behavior, narrow the path, propose smallest safe fix, and include validation. Avoids broad refactoring and final-outcome judgment. | Preferred. |
| Short | Good diagnostic skeleton, but loses expected-vs-observed detail, confidence, and validation-command specificity. | Too compressed. |

### planner

| Variant | Notes | Decision |
| --- | --- | --- |
| Current | Strongest specificity: exact files/modules/tests, ordered tasks, dependencies, validation, approval decisions. Downside: 211 words and more rigid structure. | Useful but too heavy. |
| Medium | Keeps essential planning behavior: inspect context, name files/interfaces/tests/dependencies/commands, small reviewable steps, no implementation, no unapproved decisions, and no scheduling/lifecycle/final-outcome authority. | Preferred. |
| Short | Very concise and safe, but less actionable: drops approval points, interfaces, dependencies, and validation-command emphasis. | Too compressed. |

## Decision

Adopt Medium. It preserved boundary safety and actionability for `scout`, `reviewer`, `debugger`, and `planner` while reducing prompt weight from 1,991 to 1,146 words, a 42% reduction. The strongest observation was that Medium kept the behavior-shaping constraints that matter for each profile while Short repeatedly lost useful specificity, especially review evidence discipline, debugger expected-vs-observed detail, and planner validation/dependency guidance.

A reviewer subagent independently recommended Medium for all four required profiles. It found one draft issue: two positive Medium bullets were accidentally placed under `Do not:` in the temporary drafts. The temporary Medium drafts were corrected before implementation.

## Variant metrics

```json
[
  {
    "variant": "medium",
    "totalWords": 1146,
    "averageWords": 115,
    "rows": [
      {
        "id": "context-builder",
        "words": 120,
        "chars": 824
      },
      {
        "id": "debugger",
        "words": 122,
        "chars": 796
      },
      {
        "id": "delegate",
        "words": 114,
        "chars": 737
      },
      {
        "id": "docs-writer",
        "words": 118,
        "chars": 809
      },
      {
        "id": "oracle",
        "words": 115,
        "chars": 789
      },
      {
        "id": "planner",
        "words": 110,
        "chars": 726
      },
      {
        "id": "researcher",
        "words": 107,
        "chars": 744
      },
      {
        "id": "reviewer",
        "words": 111,
        "chars": 745
      },
      {
        "id": "scout",
        "words": 115,
        "chars": 721
      },
      {
        "id": "worker",
        "words": 114,
        "chars": 747
      }
    ]
  },
  {
    "variant": "short",
    "totalWords": 686,
    "averageWords": 69,
    "rows": [
      {
        "id": "context-builder",
        "words": 75,
        "chars": 565
      },
      {
        "id": "debugger",
        "words": 69,
        "chars": 501
      },
      {
        "id": "delegate",
        "words": 65,
        "chars": 487
      },
      {
        "id": "docs-writer",
        "words": 71,
        "chars": 531
      },
      {
        "id": "oracle",
        "words": 70,
        "chars": 527
      },
      {
        "id": "planner",
        "words": 66,
        "chars": 500
      },
      {
        "id": "researcher",
        "words": 63,
        "chars": 495
      },
      {
        "id": "reviewer",
        "words": 71,
        "chars": 540
      },
      {
        "id": "scout",
        "words": 69,
        "chars": 504
      },
      {
        "id": "worker",
        "words": 67,
        "chars": 514
      }
    ]
  }
]
```
