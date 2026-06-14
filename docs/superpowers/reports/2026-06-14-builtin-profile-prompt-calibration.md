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
