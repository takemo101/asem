/**
 * Bottom footer (design "Visual structure"): available keys, the transient
 * status/error line, and the auto-refresh state, rendered from the pure view.
 * The footer occupies a fixed {@link FOOTER_HEIGHT} so the layout never jumps
 * when a status line appears, and the status is clamped to one bounded line so
 * a long or multiline error can never wrap into the panes.
 */
import type { ReactNode } from "react";
import type { KeybarItem } from "../../view.ts";
import { theme } from "../theme.ts";

/** Fixed footer height: border (2) + keybar row + status row. */
export const FOOTER_HEIGHT = 4;

/** Longest status line rendered before truncation. */
const STATUS_MAX_CHARS = 160;

/** Compose the keybar text (pure; exported for tests). */
export function keybarText(keybar: KeybarItem[], autoLabel: string): string {
  return [...keybar.map((item) => `${item.key} ${item.label}`), autoLabel].join(
    "   ",
  );
}

/**
 * Clamp the transient status to a single bounded line (pure; exported for
 * tests): first line only, truncated with `…` past {@link STATUS_MAX_CHARS}.
 */
export function statusLineText(statusLine: string | null): string {
  if (statusLine === null) {
    return "";
  }
  const first = statusLine.split("\n", 1)[0] ?? "";
  if (first.length <= STATUS_MAX_CHARS) {
    return first;
  }
  return `${first.slice(0, STATUS_MAX_CHARS - 1)}…`;
}

export function Footer(props: {
  keybar: KeybarItem[];
  statusLine: string | null;
  autoLabel: string;
}): ReactNode {
  const status = statusLineText(props.statusLine);
  const isError = status.startsWith("error:");
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
      <text fg={isError ? theme.red : theme.green}>{status}</text>
    </box>
  );
}
