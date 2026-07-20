# Session-row truncation-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove horizontal scrolling from the Cockpit Session list and ellipsize every overflowing row.

**Architecture:** Restore the ScrollBox's viewport-constrained content layout. Remove the special Session-row and group-header width logic introduced for horizontal scrolling, so all rows share the same full-width clipped text layout.

**Tech Stack:** TypeScript, React, OpenTUI, Bun test, Biome.

## Global Constraints

- No horizontal scroll range is allowed for Session rows or group headings.
- Preserve vertical scrolling, tree indentation, height `1`, `overflow="hidden"`, `width="100%"`, and `wrapMode="none"`.
- Write a rendered regression test first and observe it fail before changing production code.

---

### Task 1: Restore viewport-constrained, ellipsized Session rows

**Files:**

- Modify: `packages/tui/test/opentui.test.ts`
- Modify: `packages/tui/src/opentui/components/session-list.tsx`
- Modify: `docs/superpowers/specs/2026-07-12-session-list-session-row-horizontal-scroll-design.md`

**Interfaces:**

- Consumes: `SessionRowsScrollBox({ rows, bodyRows })`.
- Produces: a vertical-only `scrollbox`; every row text has `truncate: true`; rendered long rows have `scrollWidth === viewport.width`.

- [ ] **Step 1: Write the failing rendered regression test**

Replace the horizontal-overflow geometry tests with a long Session-row test rendered at a narrow viewport. Assert `scrollX: false`, `scrollWidth === viewport.width`, a captured ellipsis, and a full-width one-line row box.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
```

Expected: FAIL because the current viewport has `scrollX: true` and a long Session label increases `scrollWidth` beyond the viewport.

- [ ] **Step 3: Write the minimal rendering change**

- Remove `SESSION_LIST_CHROME_WIDTH` and `sessionListInnerWidth`.
- Remove `innerWidth` from `SessionRowsScrollBox` and its `SessionList` call.
- Set `scrollX={false}` and restore `contentOptions={{ flexDirection: "column", width: "100%" }}`.
- Give every row box `width="100%"` and every row text `truncate={true}`.

- [ ] **Step 4: Verify the focused test and all checks**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
bun run typecheck
bun run test
bun run check
```

Expected: every command succeeds.
