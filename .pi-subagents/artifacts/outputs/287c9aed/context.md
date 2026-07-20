# Code Context

## Files Retrieved

1. `/Users/takemo101/Desktop/workspace/asem/packages/ops/src/operations/send-message.ts` (lines 247-345) — report/message persistence and delivery-state control flow.
2. `/Users/takemo101/Desktop/workspace/asem/packages/runtime/src/engine/sequence.ts` (lines 90-128, 180-252) — command-sequence failure/ignore semantics.
3. `/Users/takemo101/Desktop/workspace/asem/packages/runtime/src/template/builtin.ts` (lines 51-98) — current builtin Herdr send template.
4. `/Users/takemo101/Desktop/workspace/asem/packages/store/src/sqlite-store.ts` (lines 371-395) — SQL state transitions.
5. `/Users/takemo101/Desktop/workspace/experiment/radio/.asem.yaml` (lines 1-32) — live project override, which is the template actually selected by `reportParent`.
6. `/Users/takemo101/Desktop/workspace/experiment/radio/.asem/current-session.json` (lines 1-7) — live parent Session identity.

## Key Code

### Finding (high severity): an interrupted/unhandled path after insert can leave a permanently pending report

`deliver()` initializes both fields NULL and commits the Message **before** mux work (`send-message.ts:247-265`). It has only three normal terminal paths:

* `mux:none` returns intentionally pending (`267-270`), not applicable to the radio records (their target mux is `herdr`).
* a template/sequence failure calls `recordDeliveryError()` (`279-312`), whose SQL writes `delivery_error` (`331-345`, `sqlite-store.ts:384-395`);
* sequence success calls `markMessageDelivered()` (`315-323`), whose SQL writes `delivered_at` (`sqlite-store.ts:371-382`).

Therefore a `herdr` report with both NULL cannot be produced by any completed normal `deliver()` branch. It proves execution did not reach either state-update call after `insertMessage`, or the process/DB operation was interrupted/threw there. The operation has no `try/finally` covering the post-insert region, no transaction spanning insert and update, and no recovery reconciler.

### Live evidence

Read-only SQLite inspection of `/Users/takemo101/.asem/state.db` found exactly these radio reports, all addressed to the live Herdr parent `s_adcebdf0-3593-4352-acf5-5b2b7c95f148` and all with NULL/NULL:

* `s_12f80356-cddd-4f1a-9af8-9663b51b4a61`, `REPORT_DELIVERY_PROBE_OK`, created `2026-07-17T00:45:36.232Z`
* `s_b6ac6872-5049-4673-a379-b58f40cf1b1d`, `REPORT_DELIVERY_AFTER_RELOAD_OK`, created `2026-07-17T00:52:15.504Z`
* `s_faa38218-92ab-4e34-8e3c-7d103e61ad12`, `REPORT_DELIVERY_CLI_PROBE_OK`, created `2026-07-17T00:52:47.695Z`

The target parent row is `mux=herdr`, `herdr_session=wave-tui`, `pane_id=w1:p1`, `herdr_workspace_id=w1`; its current-session file confirms the same ID. `herdr --session wave-tui workspace list` reports workspace `w1` active and idle.

### Strong configuration defect, likely trigger but not conclusively proven as the interruption

Radio overrides the builtin Herdr `send` sequence. Its first command is `herdr ... wait agent-status ...` with `on_error: ignore`, then it runs:

```yaml
herdr --session {{herdr_session_shell}} pane run {{pane_id_shell}} {{message_shell}}
```

(`radio/.asem.yaml:26-31`).

That differs materially from the current builtin, which uses `agent wait`, `agent send`, a 200ms settle, then `pane send-keys ... Enter` (`builtin.ts:76-98`). The live override's wait failure is expressly swallowed by `SequenceEngine` (`sequence.ts:102-109`); it cannot itself persist an error. `pane run` is also a different operation from the builtin message-injection + submit protocol. This makes the override the most plausible Herdr-specific point at which the reporter can block/be terminated after insertion, but no retained CLI log/process exit status was found, so it is not proof of the exact interruption mechanism.

## Architecture

`asem report parent` resolves the current authenticated Session and parent, then delegates to `deliver()` (`send-message.ts:158-221`). `deliver()` selects the project config registry, so radio's `.asem.yaml` overrides builtin Herdr behavior. `SequenceEngine` converts command nonzero/throws to a failure result unless the individual step says `on_error: ignore`; delivery then should persist a state transition. SQLite makes insert and updates separate statements.

## Start Here

Open `/Users/takemo101/Desktop/workspace/asem/packages/ops/src/operations/send-message.ts` at line 247. It contains the definitive NULL initialization, pre-send insert, and all intended post-insert transitions.

## Residual Risks

* Exact process-level cause is **uncertain**: evidence establishes post-insert noncompletion, but not whether `pane run` hung, the reporter was killed, or an unexpected exception occurred during/after command execution.
* The current implementation can create the same NULL/NULL orphan for any mux if the CLI is interrupted after line 265; it is not intrinsically a Herdr storage mapping bug.
* No CLI log table/file was available in inspected radio state to correlate the three report timestamps with Herdr command completion.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete high-severity post-insert control-flow finding with exact source locations, plus three live SQLite radio records and the active project Herdr override."
    }
  ],
  "changedFiles": [
    "/Users/takemo101/Desktop/workspace/asem/.pi-subagents/artifacts/outputs/287c9aed/context.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read-only Python sqlite3 queries against /Users/takemo101/.asem/state.db",
      "result": "passed",
      "summary": "Found 3 radio report Messages with delivered_at and delivery_error both NULL and identified their Herdr parent refs."
    },
    {
      "command": "herdr --session wave-tui workspace list",
      "result": "passed",
      "summary": "Live target workspace w1 exists, is active, and is idle."
    },
    {
      "command": "asem --version; source/config inspection",
      "result": "passed",
      "summary": "CLI is a shell shim executing the current asem source; radio project config supplies a custom Herdr send template."
    }
  ],
  "validationOutput": [
    "Investigation only; no application files edited and no delivery command was issued."
  ],
  "residualRisks": [
    "Exact interruption mechanism after insert remains unproven without runtime logs or a controlled reproduction.",
    "The live custom Herdr send template is likely involved but configuration evidence alone cannot prove it caused termination."
  ],
  "noStagedFiles": true,
  "diffSummary": "Investigation artifact only.",
  "reviewFindings": [
    "high: send-message.ts:264-316 persists before attempting mux delivery but has no protection/recovery for interruption or throw before either delivery-state update; this exactly permits NULL/NULL report rows.",
    "high: radio/.asem.yaml:26-31 overrides the tested builtin Herdr agent-send/Enter protocol with wait(agent-status, ignored) plus pane run, creating a Herdr-specific unverified delivery path."
  ],
  "manualNotes": "No edits were made outside the mandated findings artifact."
}
```
