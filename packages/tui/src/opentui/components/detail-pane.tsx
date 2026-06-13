/**
 * Right panel: the Messages / Detail / Context tab bar, the active tab's
 * rendered lines, and the compact activity strip below them (design "Visual
 * structure"). Lines are clipped to the pane so resizes never overlap the
 * footer.
 */
import type { ReactNode } from "react";
import type { ActivityRowView } from "../../view/activity-row.ts";
import type { TabHeader } from "../../view.ts";
import { theme } from "../theme.ts";
import { ActivityStrip } from "./activity-strip.tsx";

/** Rows reserved for the activity strip (header + rows) when activity exists. */
const ACTIVITY_MAX_ROWS = 6;

export function DetailPane(props: {
  tabs: TabHeader[];
  lines: string[];
  activity: ActivityRowView[];
  maxVisibleRows: number;
}): ReactNode {
  const stripRows =
    props.activity.length === 0
      ? 0
      : Math.min(props.activity.length, ACTIVITY_MAX_ROWS) + 1;
  const bodyRows = Math.max(1, props.maxVisibleRows - stripRows - 1);
  const tabBar = props.tabs
    .map((tab) => (tab.active ? `[${tab.title}]` : ` ${tab.title} `))
    .join(" ");
  return (
    <box
      borderStyle="single"
      borderColor={theme.border}
      backgroundColor={theme.panel}
      flexGrow={1}
      flexDirection="column"
      minHeight={0}
      paddingX={1}
    >
      <box backgroundColor={theme.panelAlt} height={1}>
        <text fg={theme.cyan}>{tabBar}</text>
      </box>
      <box flexDirection="column" flexGrow={1} minHeight={0}>
        <text fg={theme.text}>{props.lines.slice(0, bodyRows).join("\n")}</text>
      </box>
      <ActivityStrip activity={props.activity} maxRows={ACTIVITY_MAX_ROWS} />
    </box>
  );
}
