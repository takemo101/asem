# Session-row horizontal scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators horizontally scroll complete Session-row text in the Cockpit while leaving group headings truncated.

**Architecture:** Keep the existing `SessionRowsScrollBox` as the sole scroll viewport. Enable its horizontal axis, then derive each row text element's `truncate` property from the row kind. This changes only the OpenTUI rendering projection; no domain, operation, or stored state changes are needed.

**Tech Stack:** TypeScript, React, OpenTUI, Bun test, Biome.

## Global Constraints

- Apply the behavior only to `LeftRow` values where `kind === "session"`.
- Preserve group-heading truncation, one-row height, `wrapMode="none"`, vertical scrolling, and current Session-list width calculation.
- Write the regression test first and observe it fail before changing production code.
- Do not add persistent Session state, new keyboard bindings, or layout-width changes.

---

### Task 1: Enable full-width Session-row content in the existing list viewport

**Files:**

- Modify: `packages/tui/test/opentui.test.ts:200-266`
- Modify: `packages/tui/src/opentui/components/session-list.tsx:114-163`

**Interfaces:**

- Consumes: `SessionRowsScrollBox({ rows, bodyRows })`, where each row is a `LeftRow` with `kind: "session" | "group"`.
- Produces: a `scrollbox` with `scrollX: true`; Session-row `<text>` props with `truncate: false`; group-heading `<text>` props with `truncate: true`.

- [ ] **Step 1: Write the failing component-projection test**

Replace the existing test named `clips long Session rows to one visible line` with a test containing both row kinds. Assert that the outer scrollbox has horizontal scrolling, that the Session row retains its one-line layout but has `truncate: false`, and that the group row has `truncate: true`.

```ts
test("keeps long Session rows scrollable while truncating group headers", () => {
  const rows: LeftRow[] = [
    {
      kind: "session",
      sessionId: "s1",
      name: "very-long-worker-name-that-would-overflow-the-left-panel",
      depth: 0,
      status: "running",
      symbol: "●",
      selected: true,
      badge: 0,
      isNew: false,
      location: "/repo/bookmark-ai-extension-with-a-very-long-name",
    },
    { kind: "group", worktreeRoot: "/repo/a-very-long-worktree-root" },
  ];
  const scrollbox = SessionRowsScrollBox({ rows, bodyRows: 2 }) as ReactElement;
  const [sessionRow, groupRow] = reactChildren(reactProps(scrollbox).children);
  if (!isReactElement(sessionRow) || !isReactElement(groupRow)) {
    throw new Error("expected Session and group row boxes");
  }
  const sessionText = reactChildren(reactProps(sessionRow).children).at(0);
  const groupText = reactChildren(reactProps(groupRow).children).at(0);
  if (!isReactElement(sessionText) || !isReactElement(groupText)) {
    throw new Error("expected row text elements");
  }

  expect(scrollbox.props).toMatchObject({ scrollY: true, scrollX: true });
  expect(sessionText.props).toMatchObject({
    height: 1,
    truncate: false,
    width: "100%",
    wrapMode: "none",
  });
  expect(groupText.props).toMatchObject({
    height: 1,
    truncate: true,
    width: "100%",
    wrapMode: "none",
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
```

Expected: FAIL because the scrollbox has `scrollX: false` and every row's text has `truncate: true`.

- [ ] **Step 3: Write the minimal rendering change**

In the existing `<scrollbox>` element in `SessionRowsScrollBox`, change only `scrollX={false}` to `scrollX={true}`; retain every other property. Then replace the unconditional text property with:

```tsx
truncate={row.kind === "group"}
```

Leave `height={1}`, `width="100%"`, and `wrapMode="none"` unchanged.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
```

Expected: PASS, including the test that distinguishes Session rows from group headings.

- [ ] **Step 5: Run formatting, type, and full regression checks**

Run:

```sh
bun run typecheck
bun run test
bun run check
```

Expected: all commands exit successfully.

- [ ] **Step 6: Commit the isolated implementation change**

Use GitButler to inspect the precise diff and commit only:

- `packages/tui/src/opentui/components/session-list.tsx`
- `packages/tui/test/opentui.test.ts`
- `docs/superpowers/specs/2026-07-12-session-list-session-row-horizontal-scroll-design.md`
- `docs/superpowers/plans/2026-07-17-session-row-horizontal-scroll.md`

Use a commit message such as:

```text
fix(tui): allow horizontal scrolling of session rows
```
