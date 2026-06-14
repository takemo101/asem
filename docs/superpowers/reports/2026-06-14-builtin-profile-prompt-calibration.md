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

## Variant metrics

```json
[
  {
    "variant": "medium",
    "totalWords": 1144,
    "averageWords": 114,
    "rows": [
      {
        "id": "context-builder",
        "words": 119,
        "chars": 818
      },
      {
        "id": "debugger",
        "words": 122,
        "chars": 798
      },
      {
        "id": "delegate",
        "words": 112,
        "chars": 731
      },
      {
        "id": "docs-writer",
        "words": 118,
        "chars": 811
      },
      {
        "id": "oracle",
        "words": 116,
        "chars": 783
      },
      {
        "id": "planner",
        "words": 110,
        "chars": 728
      },
      {
        "id": "researcher",
        "words": 107,
        "chars": 746
      },
      {
        "id": "reviewer",
        "words": 111,
        "chars": 749
      },
      {
        "id": "scout",
        "words": 115,
        "chars": 723
      },
      {
        "id": "worker",
        "words": 114,
        "chars": 749
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
