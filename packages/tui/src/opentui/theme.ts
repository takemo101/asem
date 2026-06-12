/**
 * Cockpit theme for the OpenTUI renderer, following cuekit's `theme.ts`
 * discipline (design "Visual structure"): one small palette object plus
 * status→accent helpers. Colors stay process/connection oriented — a `missing`
 * red is a liveness signal, never a work outcome.
 */
import type { SessionStatus } from "@asem/core";
import type { ActivityRowView } from "../view.ts";

export const theme = {
  bg: "#2b2b2b",
  headerBg: "#1a1a1a",
  headerFg: "#76c7c8",
  panel: "#303030",
  panelAlt: "#242424",
  row: "#1b1b1b",
  rowAlt: "#333333",
  rowSelected: "#4a4a4a",
  border: "#5a5a5a",
  muted: "#777777",
  text: "#d7d7d7",
  strong: "#eeeeee",
  cyan: "#76c7c8",
  green: "#7fb36a",
  yellow: "#d6bb6b",
  red: "#cf6f6a",
  blue: "#8ea0ff",
  purple: "#b19cd9",
} as const;

/** Accent color for a Session's process/connection status. */
export function statusAccent(status: SessionStatus): string {
  switch (status) {
    case "starting":
      return theme.cyan;
    case "running":
      return theme.green;
    case "exited":
      return theme.muted;
    case "missing":
      return theme.red;
    case "closed":
      return theme.yellow;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

/** Accent color for an activity-strip row tone. */
export function activityAccent(tone: ActivityRowView["tone"]): string {
  switch (tone) {
    case "add":
      return theme.green;
    case "remove":
      return theme.muted;
    case "warn":
      return theme.yellow;
    case "info":
      return theme.text;
    default: {
      const _never: never = tone;
      return _never;
    }
  }
}
