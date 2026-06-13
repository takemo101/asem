# TUI Toast Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenTUI footer status/error row with typed `CockpitNotice` feedback rendered as `@opentui-ui/toast` toasts, while keeping ANSI fallback feedback.

**Architecture:** `CockpitApp` owns a transient `CockpitNotice | null` instead of a string `statusLine`; `CockpitView` projects that typed notice to renderers. The OpenTUI renderer converts notices to themed single toast notifications and keeps a compact footer; the ANSI renderer converts notices back to a textual footer line.

**Tech Stack:** TypeScript, Bun tests, React/OpenTUI, `@opentui-ui/toast`, GitButler `but` workflow.

---

## File structure

- Modify `packages/tui/src/view.ts`
  - Add `CockpitNotice` type.
  - Replace `CockpitView.statusLine` with `CockpitView.notice`.
  - Replace `renderCockpitView(... { statusLine })` option with `notice`.
- Modify `packages/tui/src/app.ts`
  - Replace transient `statusLine` field with transient `notice` field.
  - Convert success/info/error outcomes into typed notices.
  - Clear auto-refresh error notice after a later successful auto-refresh.
- Modify `packages/tui/src/terminal-host.ts`
  - Render `CockpitView.notice` as a footer line for the ANSI/string fallback.
- Modify `packages/tui/src/opentui/components/footer.tsx`
  - Remove status-line text handling.
  - Change `FOOTER_HEIGHT` from `4` to `3`.
- Modify `packages/tui/src/opentui/app.tsx`
  - Add toast toaster rendering and notice emission above the compact footer.
  - Remove `statusLine` prop passed to `Footer`.
- Create `packages/tui/src/opentui/notice-toast.tsx`
  - Isolate the OpenTUI toast dependency and bridge logic.
  - Export pure helpers for smoke tests: notice key, options, and payload mapping.
- Modify `packages/tui/package.json`
  - Add `@opentui-ui/toast` dependency pinned to the working version.
- Modify `packages/tui/test/app.test.ts`
  - Assert typed notices for success/error effects and auto-refresh recovery.
- Modify `packages/tui/test/view.test.ts`
  - Assert `renderCockpitView` projects `notice` instead of `statusLine`.
- Modify `packages/tui/test/opentui.test.ts`
  - Assert compact footer height and toast bridge mapping/import smoke.
- Modify `packages/tui/test/terminal-host.test.ts`
  - Assert ANSI fallback renders notice as a footer line.
- Modify `docs/designs/asem-tui-workspace-live-cockpit-design.md`
  - Already updated by design step; keep in sync if implementation diverges.
- Modify `docs/designs/asem-session-manager-design.md`
  - Already updated by design step; keep in sync if implementation diverges.

---

### Task 1: Add typed `CockpitNotice` to the pure projection

**Files:**
- Modify: `packages/tui/src/view.ts`
- Test: `packages/tui/test/view.test.ts`

- [ ] **Step 1: Write the failing projection test**

Add this test near the existing `keybar and modals` tests in `packages/tui/test/view.test.ts`:

```ts
test("notice is projected as typed transient feedback", () => {
  const state = createCockpitState(makeEnv(), snapshot([]));
  const view = renderCockpitView(state, {
    notice: { level: "error", message: "boom", code: "timeout" },
  });

  expect(view.notice).toEqual({
    level: "error",
    message: "boom",
    code: "timeout",
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```sh
bun test packages/tui/test/view.test.ts --grep "notice is projected"
```

Expected: FAIL because `renderCockpitView` does not accept `notice` and `CockpitView` has no `notice` property.

- [ ] **Step 3: Add the type and projection**

In `packages/tui/src/view.ts`, replace the `statusLine` field with this type and field:

```ts
export type CockpitNotice =
  | { level: "success"; message: string }
  | { level: "info"; message: string }
  | { level: "error"; message: string; code: string };

/** The full renderer-agnostic screen description. */
export interface CockpitView {
  header: HeaderView;
  left: LeftPaneView;
  tabs: TabHeader[];
  /** Rendered lines for the active tab. */
  right: string[];
  /** Recent in-memory activity rows, oldest first (empty when quiet). */
  activity: ActivityRowView[];
  keybar: KeybarItem[];
  modal: ModalView | null;
  /** Transient renderer-neutral cockpit feedback, or null. */
  notice: CockpitNotice | null;
}
```

Update `renderCockpitView` options from `statusLine?: string | null` to:

```ts
notice?: CockpitNotice | null;
```

Update the return object field:

```ts
notice: options.notice ?? null,
```

- [ ] **Step 4: Run the projection test**

Run:

```sh
bun test packages/tui/test/view.test.ts --grep "notice is projected"
```

Expected: PASS.

- [ ] **Step 5: Run targeted typecheck for touched package**

Run:

```sh
bun run typecheck
```

Expected: FAIL with remaining references to `statusLine`. Do not fix them in this task except in `view.ts`; the failures identify the next task boundaries.

- [ ] **Step 6: Commit**

Use GitButler, not `git add`/`git commit`:

```sh
but status -fv
but commit tui-toast-notices --create -m "Add typed cockpit notice projection" --changes <ids from but status> --no-hooks --status-after
```

Expected: one commit on branch `tui-toast-notices` with `view.ts` and `view.test.ts` changes.

---

### Task 2: Convert `CockpitApp` from `statusLine` to typed notices

**Files:**
- Modify: `packages/tui/src/app.ts`
- Test: `packages/tui/test/app.test.ts`

- [ ] **Step 1: Write failing success notice tests**

Add these tests inside `describe("CockpitApp effects", ...)` in `packages/tui/test/app.test.ts`:

```ts
test("manual refresh sets an info notice", async () => {
  const store = new FakeStore();
  const { app } = makeApp({ store });

  const result = await app.dispatch({ type: "refresh" });

  expect(result.error).toBeUndefined();
  expect(app.view().notice).toEqual({ level: "info", message: "refreshed" });
});

test("send success sets a success notice", async () => {
  const store = new FakeStore();
  store.sessions.push(makeSession({ id: "s1", name: "one" }));
  const { app } = makeApp({ store });

  await app.dispatch({ type: "openSend" });
  await app.dispatch({ type: "updateDraft", draft: "ping" });
  const result = await app.dispatch({ type: "submitSend" });

  expect(result.error).toBeUndefined();
  expect(app.view().notice).toEqual({
    level: "success",
    message: "sent message to s1",
  });
});
```

- [ ] **Step 2: Write failing refresh error/recovery tests**

Add a test helper fake by using existing `makeOpsDeps` fakes. If the existing fake loader path makes config failures easier than store failures, script `deps.configLoader` or `deps.scopeResolver` consistently with the existing app tests. Add this behavior test:

```ts
test("auto-refresh error sets an error notice and later success clears it", async () => {
  const store = new FakeStore();
  const { app } = makeApp({ store });

  app.reportOperationError({ code: "temporary", message: "network hiccup" });
  expect(app.view().notice).toEqual({
    level: "error",
    code: "temporary",
    message: "network hiccup",
  });

  const result = await app.dispatch({ type: "refresh" });

  expect(result.error).toBeUndefined();
  expect(app.view().notice).toEqual({ level: "info", message: "refreshed" });
});
```

This covers the clearing path via a successful refresh action. If implementation touches the `run()` tick path directly, add a host-loop test with `FakeHost.nextKeyOrTick` scripting in the same file.

- [ ] **Step 3: Run failing tests**

Run:

```sh
bun test packages/tui/test/app.test.ts --grep "notice"
```

Expected: FAIL because `app.view().notice` is absent or still null.

- [ ] **Step 4: Implement typed notice state in `CockpitApp`**

In `packages/tui/src/app.ts`, import the type:

```ts
import type { CockpitNotice } from "./view.ts";
```

Replace:

```ts
private statusLine: string | null = null;
```

with:

```ts
private notice: CockpitNotice | null = null;
```

Update `view()`:

```ts
return renderCockpitView(this.state, {
  notice: this.notice,
  ...(this.host.nextKeyOrTick !== undefined
    ? { autoRefreshMs: this.autoRefreshMs }
    : {}),
});
```

In `dispatch`, when no effect is emitted, clear the notice:

```ts
if (effect === undefined) {
  this.notice = null;
  return { quit: false };
}
```

Replace `setStatus` with:

```ts
private setNotice(
  error: OperationError | undefined,
  ok: { level: "success" | "info"; message: string } | null,
): void {
  this.notice =
    error === undefined
      ? ok
      : { level: "error", code: error.code, message: error.message };
}
```

Update effect handlers:

```ts
this.setNotice(
  error,
  session === null ? null : { level: "success", message: `attached to ${session.name}` },
);
```

```ts
this.setNotice(error, { level: "info", message: "refreshed" });
```

```ts
this.setNotice(refreshError, {
  level: "success",
  message: outcomeStatus(result.value),
});
```

Update `reportOperationError` fallback:

```ts
this.notice =
  state.modal.kind === "error"
    ? null
    : { level: "error", code: error.code, message: error.message };
```

Update the auto-refresh tick branch:

```ts
if (error !== undefined) {
  this.notice = { level: "error", code: error.code, message: error.message };
} else if (this.notice?.level === "error") {
  this.notice = null;
}
```

- [ ] **Step 5: Run app tests**

Run:

```sh
bun test packages/tui/test/app.test.ts --grep "notice"
bun test packages/tui/test/app.test.ts
```

Expected: PASS for app tests, except unrelated existing lint warnings are not relevant here.

- [ ] **Step 6: Commit**

Use the existing branch created in Task 1:

```sh
but status -fv
but commit tui-toast-notices -m "Use typed notices in cockpit app" --changes <ids from but status> --no-hooks --status-after
```

Expected: second commit with `app.ts` and `app.test.ts` changes.

---

### Task 3: Preserve ANSI fallback notice rendering

**Files:**
- Modify: `packages/tui/src/terminal-host.ts`
- Test: `packages/tui/test/terminal-host.test.ts`

- [ ] **Step 1: Write failing ANSI fallback tests**

Add tests in `packages/tui/test/terminal-host.test.ts` using existing `renderFrame` helpers:

```ts
test("renderFrame renders info notices in the footer fallback", () => {
  const state = createCockpitState(makeEnv(), { sessions: [], messages: [] });
  const view = renderCockpitView(state, {
    notice: { level: "info", message: "refreshed" },
  });

  expect(renderFrame(view)).toContain("refreshed");
});

test("renderFrame renders error notices with code in the footer fallback", () => {
  const state = createCockpitState(makeEnv(), { sessions: [], messages: [] });
  const view = renderCockpitView(state, {
    notice: { level: "error", message: "boom", code: "timeout" },
  });

  expect(renderFrame(view)).toContain("error: timeout: boom");
});
```

- [ ] **Step 2: Run failing ANSI tests**

Run:

```sh
bun test packages/tui/test/terminal-host.test.ts --grep "notice"
```

Expected: FAIL because `terminal-host.ts` still reads `view.statusLine`.

- [ ] **Step 3: Implement notice formatting**

In `packages/tui/src/terminal-host.ts`, add:

```ts
function noticeLine(view: CockpitView): string | null {
  const { notice } = view;
  if (notice === null) {
    return null;
  }
  return notice.level === "error"
    ? `error: ${notice.code}: ${notice.message}`
    : notice.message;
}
```

Update `footerLines`:

```ts
const notice = noticeLine(view);
if (notice !== null) {
  lines.push(notice);
}
```

Remove all `view.statusLine` references.

- [ ] **Step 4: Run ANSI tests**

Run:

```sh
bun test packages/tui/test/terminal-host.test.ts --grep "notice"
bun test packages/tui/test/terminal-host.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
but status -fv
but commit tui-toast-notices -m "Render cockpit notices in ANSI fallback" --changes <ids from but status> --no-hooks --status-after
```

Expected: third commit with terminal fallback changes.

---

### Task 4: Compact the OpenTUI footer

**Files:**
- Modify: `packages/tui/src/opentui/components/footer.tsx`
- Modify: `packages/tui/src/opentui/app.tsx`
- Test: `packages/tui/test/opentui.test.ts`

- [ ] **Step 1: Write failing footer tests**

In `packages/tui/test/opentui.test.ts`, replace the footer tests that reference `statusLineText` with compact footer expectations:

```ts
describe("footer", () => {
  test("keybar text includes every key and the auto state", () => {
    const text = keybarText([...KEYBAR], "auto 3s");
    for (const item of KEYBAR) {
      expect(text).toContain(`${item.key} ${item.label}`);
    }
    expect(text).toContain("auto 3s");
  });

  test("footer height is compact after notices moved to toast", () => {
    expect(FOOTER_HEIGHT).toBe(3);
  });
});
```

Also remove `statusLineText` from the imports.

- [ ] **Step 2: Run failing footer test**

Run:

```sh
bun test packages/tui/test/opentui.test.ts --grep "footer"
```

Expected: FAIL because `FOOTER_HEIGHT` is still `4` and `Footer` still expects `statusLine`.

- [ ] **Step 3: Implement compact footer**

In `packages/tui/src/opentui/components/footer.tsx`, replace the file body with:

```tsx
/**
 * Bottom footer (design "Visual structure"): available keys and the
 * auto-refresh state. Transient cockpit notices are rendered by OpenTUI toasts,
 * while ANSI fallback rendering can still project notices as footer text.
 */
import type { ReactNode } from "react";
import type { KeybarItem } from "../../view.ts";
import { theme } from "../theme.ts";

/** Fixed footer height: border (2) + keybar row. */
export const FOOTER_HEIGHT = 3;

/** Compose the keybar text (pure; exported for tests). */
export function keybarText(keybar: KeybarItem[], autoLabel: string): string {
  return [...keybar.map((item) => `${item.key} ${item.label}`), autoLabel].join(
    "   ",
  );
}

export function Footer(props: {
  keybar: KeybarItem[];
  autoLabel: string;
}): ReactNode {
  return (
    <box
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.panel}
      paddingX={1}
      height={FOOTER_HEIGHT}
      flexDirection="column"
      flexShrink={0}
    >
      <text fg={theme.cyan}>{keybarText(props.keybar, props.autoLabel)}</text>
    </box>
  );
}
```

In `packages/tui/src/opentui/app.tsx`, remove the `statusLine={view.statusLine}` prop:

```tsx
<Footer keybar={view.keybar} autoLabel={view.header.autoLabel} />
```

- [ ] **Step 4: Run footer/OpenTUI tests**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
bun test packages/tui/test/view.test.ts packages/tui/test/app.test.ts packages/tui/test/terminal-host.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
but status -fv
but commit tui-toast-notices -m "Compact OpenTUI footer" --changes <ids from but status> --no-hooks --status-after
```

Expected: fourth commit with compact footer changes.

---

### Task 5: Add OpenTUI toast bridge

**Files:**
- Modify: `packages/tui/package.json`
- Create: `packages/tui/src/opentui/notice-toast.tsx`
- Modify: `packages/tui/src/opentui/app.tsx`
- Test: `packages/tui/test/opentui.test.ts`
- Modify: `bun.lock`

- [ ] **Step 1: Add dependency**

Run:

```sh
bun add @opentui-ui/toast@0.0.5 --filter @asem/tui
```

Expected: `packages/tui/package.json` includes `@opentui-ui/toast`, and `bun.lock` updates. If Bun workspace filter syntax fails, edit `packages/tui/package.json` manually and run `bun install` from the repository root.

The dependency entry should be:

```json
"@opentui-ui/toast": "0.0.5"
```

- [ ] **Step 2: Write bridge smoke tests**

In `packages/tui/test/opentui.test.ts`, add imports:

```ts
import {
  noticeKey,
  noticeToastPayload,
  TOASTER_OPTIONS,
} from "../src/opentui/notice-toast.tsx";
```

Add tests:

```ts
describe("notice toast bridge", () => {
  test("noticeKey dedupes identical notices", () => {
    expect(
      noticeKey({ level: "error", message: "boom", code: "timeout" }),
    ).toBe("error\u0000timeout\u0000boom");
    expect(noticeKey(null)).toBeNull();
  });

  test("noticeToastPayload maps error code to description", () => {
    expect(
      noticeToastPayload({ level: "error", message: "boom", code: "timeout" }),
    ).toEqual({
      method: "error",
      message: "boom",
      options: { description: "code: timeout", duration: 10000 },
    });
  });

  test("noticeToastPayload maps success and info durations", () => {
    expect(noticeToastPayload({ level: "success", message: "sent" })).toEqual({
      method: "success",
      message: "sent",
      options: { duration: 4000 },
    });
    expect(noticeToastPayload({ level: "info", message: "refreshed" })).toEqual({
      method: "info",
      message: "refreshed",
      options: { duration: 4000 },
    });
  });

  test("toaster options keep notices above the compact footer", () => {
    expect(TOASTER_OPTIONS.position).toBe("bottom-right");
    expect(TOASTER_OPTIONS.stackingMode).toBe("single");
    expect(TOASTER_OPTIONS.offset?.bottom).toBe(FOOTER_HEIGHT);
  });
});
```

- [ ] **Step 3: Run failing bridge tests**

Run:

```sh
bun test packages/tui/test/opentui.test.ts --grep "notice toast bridge"
```

Expected: FAIL because `notice-toast.tsx` does not exist.

- [ ] **Step 4: Implement toast bridge**

Create `packages/tui/src/opentui/notice-toast.tsx`:

```tsx
/** @jsxImportSource @opentui/react */

import { toast, Toaster } from "@opentui-ui/toast/react";
import { useEffect, useRef, type ReactNode } from "react";
import type { CockpitNotice } from "../view.ts";
import { FOOTER_HEIGHT } from "./components/footer.tsx";
import { theme } from "./theme.ts";

type ToastMethod = "success" | "info" | "error";

export const TOASTER_OPTIONS = {
  position: "bottom-right" as const,
  stackingMode: "single" as const,
  offset: { bottom: FOOTER_HEIGHT, right: 2 },
  maxWidth: 60,
  toastOptions: {
    style: {
      backgroundColor: theme.panel,
      foregroundColor: theme.text,
      mutedColor: theme.muted,
      borderColor: theme.border,
      borderStyle: "single" as const,
      paddingX: 1,
      paddingY: 0,
    },
    success: { style: { borderColor: theme.green }, duration: 4000 },
    info: { style: { borderColor: theme.cyan }, duration: 4000 },
    error: { style: { borderColor: theme.red }, duration: 10000 },
  },
};

export function noticeKey(notice: CockpitNotice | null): string | null {
  if (notice === null) {
    return null;
  }
  return notice.level === "error"
    ? `${notice.level}\u0000${notice.code}\u0000${notice.message}`
    : `${notice.level}\u0000\u0000${notice.message}`;
}

export function noticeToastPayload(notice: CockpitNotice): {
  method: ToastMethod;
  message: string;
  options: { description?: string; duration: number };
} {
  if (notice.level === "error") {
    return {
      method: "error",
      message: notice.message,
      options: { description: `code: ${notice.code}`, duration: 10000 },
    };
  }
  return {
    method: notice.level,
    message: notice.message,
    options: { duration: 4000 },
  };
}

export function NoticeToaster(props: { notice: CockpitNotice | null }): ReactNode {
  const lastNoticeKey = useRef<string | null>(null);

  useEffect(() => {
    const key = noticeKey(props.notice);
    if (key === null) {
      lastNoticeKey.current = null;
      return;
    }
    if (key === lastNoticeKey.current || props.notice === null) {
      return;
    }
    lastNoticeKey.current = key;
    const payload = noticeToastPayload(props.notice);
    const emit = toast[payload.method];
    emit(payload.message, payload.options);
  }, [props.notice]);

  return <Toaster {...TOASTER_OPTIONS} />;
}
```

- [ ] **Step 5: Wire bridge into OpenTUI screen**

In `packages/tui/src/opentui/app.tsx`, import:

```ts
import { NoticeToaster } from "./notice-toast.tsx";
```

Render it before `Footer` so it can overlay above the compact footer:

```tsx
{view.modal === null ? null : <ModalDialog modal={view.modal} />}
<NoticeToaster notice={view.notice} />
<Footer keybar={view.keybar} autoLabel={view.header.autoLabel} />
```

- [ ] **Step 6: Run bridge/OpenTUI tests**

Run:

```sh
bun test packages/tui/test/opentui.test.ts
bun run typecheck
```

Expected: PASS. If TypeScript complains about toast payload options or `Toaster` prop types, adjust the bridge type annotations without moving toast imports outside `packages/tui/src/opentui`.

- [ ] **Step 7: Commit**

```sh
but status -fv
but commit tui-toast-notices -m "Render cockpit notices as OpenTUI toasts" --changes <ids from but status> --no-hooks --status-after
```

Expected: fifth commit with dependency and OpenTUI bridge changes.

---

### Task 6: Final docs, validation, and PR

**Files:**
- Modify only if needed: `docs/designs/asem-tui-workspace-live-cockpit-design.md`
- Modify only if needed: `docs/designs/asem-session-manager-design.md`

- [ ] **Step 1: Run changed-file formatting/lint check**

Run:

```sh
bunx biome check \
  packages/tui/src/view.ts \
  packages/tui/src/app.ts \
  packages/tui/src/terminal-host.ts \
  packages/tui/src/opentui/app.tsx \
  packages/tui/src/opentui/components/footer.tsx \
  packages/tui/src/opentui/notice-toast.tsx \
  packages/tui/test/app.test.ts \
  packages/tui/test/view.test.ts \
  packages/tui/test/opentui.test.ts \
  packages/tui/test/terminal-host.test.ts
```

Expected: no errors. Existing warnings in unrelated lines of `packages/tui/test/app.test.ts` may appear; do not broaden the slice to clean unrelated lint baseline unless the warning is on a changed line.

- [ ] **Step 2: Run targeted tests**

Run:

```sh
bun test packages/tui/test/view.test.ts packages/tui/test/app.test.ts packages/tui/test/terminal-host.test.ts packages/tui/test/opentui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broad validation**

Run:

```sh
bun run typecheck
bun run test
```

Expected: PASS. The default test count may differ from previous runs; failures in touched files must be fixed before continuing.

- [ ] **Step 4: Dogfood the TUI manually**

Run:

```sh
bun run --filter @asem/cli asem tui
```

If the workspace script does not expose that command, run the existing local CLI entry used by this repo's tests or package scripts. In the OpenTUI cockpit:

1. Press `r` and confirm a toast appears above the footer.
2. Select a running Session and perform a safe action that emits a success notice, or use a fake/dev path if available.
3. Trigger a refresh failure only if there is a safe local way to do so; otherwise rely on automated tests for error mapping.
4. Confirm the footer contains key bindings and auto state, with no empty status row.

Expected: toast appears above the footer and does not hide the keybar.

- [ ] **Step 5: Commit final docs or validation fixes**

If docs or small fixes changed in this final task:

```sh
but status -fv
but commit tui-toast-notices -m "Finalize TUI toast notice docs" --changes <ids from but status> --no-hooks --status-after
```

Expected: no unassigned changes after commit.

- [ ] **Step 6: Create PR**

Run:

```sh
but push tui-toast-notices
cat > /tmp/pr-tui-toast-notices.md <<'EOF'
## Summary
- replace string footer statusLine with typed CockpitNotice feedback
- render OpenTUI notices as themed single toast notifications above the compact footer
- keep ANSI fallback notice rendering as footer text

## Validation
- bun test packages/tui/test/view.test.ts packages/tui/test/app.test.ts packages/tui/test/terminal-host.test.ts packages/tui/test/opentui.test.ts
- bun run typecheck
- bun run test

## Notes
- @opentui-ui/toast is only imported under packages/tui/src/opentui
- operator mutation failures still use error modals; refresh failures remain non-modal notices
EOF
gh pr create --base main --head tui-toast-notices --title "Render TUI notices as OpenTUI toasts" --body-file /tmp/pr-tui-toast-notices.md
```

Expected: PR URL printed.

---

## Self-review

- Spec coverage: typed `CockpitNotice`, OpenTUI toast rendering, compact footer, ANSI fallback, duplicate suppression, durations, error code description, auto-refresh recovery, tests, and docs are each mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, or deferred behavior remains. The only conditional text is bounded to existing fake/test seams and manual dogfood availability.
- Type consistency: `CockpitNotice`, `CockpitView.notice`, `NoticeToaster`, `noticeKey`, `noticeToastPayload`, and `TOASTER_OPTIONS` are named consistently across tasks.
