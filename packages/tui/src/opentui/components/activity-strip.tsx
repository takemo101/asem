/**
 * Compact activity strip (design "In-memory activity strip"): recent ephemeral
 * activity rows under the active tab content. Pure presentation over
 * {@link ActivityRowView} — these rows are never durable Messages or Events.
 */
import type { ReactNode } from "react";
import type { ActivityRowView } from "../../view.ts";
import { activityAccent, theme } from "../theme.ts";

export function ActivityStrip(props: {
  activity: ActivityRowView[];
  maxRows: number;
}): ReactNode {
  if (props.activity.length === 0) {
    return null;
  }
  // Rows are positional view state replaced wholesale on each frame, so a
  // position-derived key is stable for exactly as long as the row itself.
  const rows = props.activity
    .slice(-Math.max(1, props.maxRows))
    .map((row, position) => ({ row, key: `${position}:${row.text}` }));
  return (
    <box flexDirection="column" flexShrink={0}>
      <box backgroundColor={theme.panelAlt} height={1}>
        <text fg={theme.muted}>Activity</text>
      </box>
      {rows.map(({ row, key }) => (
        <box key={key} height={1}>
          <text fg={activityAccent(row.tone)}>
            {`${row.timeLabel} ${row.text}`}
          </text>
        </box>
      ))}
    </box>
  );
}
