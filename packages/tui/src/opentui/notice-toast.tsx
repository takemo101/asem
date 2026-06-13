/** @jsxImportSource @opentui/react */

/**
 * The OpenTUI toast bridge: it isolates the `@opentui-ui/toast` dependency to
 * this file (kept under `src/opentui`, never imported by MCP or the root
 * `@asem/tui` entry) and translates a transient {@link CockpitNotice} into a
 * single themed toast in the top-right corner. The pure helpers — `noticeKey`,
 * `noticeToastPayload`, and `TOASTER_OPTIONS` — are exported for smoke tests so
 * the mapping is covered without driving a real terminal.
 */
import { Toaster, toast } from "@opentui-ui/toast/react";
import { type ReactNode, useEffect, useRef } from "react";
import type { CockpitNotice } from "../view.ts";
import { theme } from "./theme.ts";

type ToastMethod = "success" | "info" | "error";

export const TOASTER_OPTIONS = {
  position: "top-right" as const,
  stackingMode: "single" as const,
  offset: { top: 1, right: 2 },
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

/**
 * A stable dedupe key for a notice (null when there is no notice). JSON keeps
 * field boundaries explicit without putting control bytes into the source file.
 */
export function noticeKey(notice: CockpitNotice | null): string | null {
  if (notice === null) {
    return null;
  }
  return notice.level === "error"
    ? JSON.stringify([notice.level, notice.code, notice.message])
    : JSON.stringify([notice.level, "", notice.message]);
}

/** Map a notice to the toast method, message, and options it should emit. */
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

/**
 * Render the toaster and emit a single toast whenever the notice changes to a
 * new value, deduping identical consecutive notices so an unchanged view does
 * not re-fire the same toast on every render.
 */
export function NoticeToaster(props: {
  notice: CockpitNotice | null;
}): ReactNode {
  const lastNoticeKey = useRef<string | null>(null);

  useEffect(() => {
    const key = noticeKey(props.notice);
    if (key === null || props.notice === null) {
      lastNoticeKey.current = null;
      return;
    }
    if (key === lastNoticeKey.current) {
      return;
    }
    lastNoticeKey.current = key;
    const payload = noticeToastPayload(props.notice);
    const emit = toast[payload.method];
    emit(payload.message, payload.options);
  }, [props.notice]);

  return <Toaster {...TOASTER_OPTIONS} />;
}
