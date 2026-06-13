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
