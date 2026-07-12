/**
 * Right panel: the Messages / Detail / Context tab bar, the active tab's
 * rendered lines, and the compact activity strip below them (design "Visual
 * structure"). Lines are clipped to the pane so resizes never overlap the
 * footer.
 */
import type { ReactNode } from "react";
import type { ActivityRowView } from "../../view/activity-row.ts";
import { timelineLineTone } from "../../view/right-pane.ts";
import type { DossierView, TabHeader } from "../../view.ts";
import { statusAccent, theme, timelineAccent } from "../theme.ts";
import { ActivityStrip } from "./activity-strip.tsx";

/** Rows reserved for the activity strip (header + rows) when activity exists. */
const ACTIVITY_MAX_ROWS = 6;

/** Rows taken by the persistent Session dossier header when present. */
const DOSSIER_ROWS = 2;

/** Element id of the scrollable Messages/Detail body, for tests and tooling. */
export const DETAIL_BODY_SCROLLBOX_ID = "detail-body-scrollbox";

export function DetailPane(props: {
  dossier: DossierView | null;
  tabs: TabHeader[];
  lines: string[];
  activity: ActivityRowView[];
  maxVisibleRows: number;
}): ReactNode {
  const stripRows =
    props.activity.length === 0
      ? 0
      : Math.min(props.activity.length, ACTIVITY_MAX_ROWS) + 1;
  const dossierRows = props.dossier === null ? 0 : DOSSIER_ROWS;
  const bodyRows = Math.max(
    1,
    props.maxVisibleRows - stripRows - dossierRows - 1,
  );
  const tabBar = props.tabs
    .map((tab) => (tab.active ? `[${tab.title}]` : ` ${tab.title} `))
    .join(" ");
  const activeTab = props.tabs.find((tab) => tab.active)?.tab;
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
      {props.dossier === null ? null : (
        <box flexDirection="column" height={DOSSIER_ROWS}>
          <text fg={statusAccent(props.dossier.status)}>
            {`${props.dossier.symbol} ${props.dossier.name} · ${props.dossier.status}`}
          </text>
          <text fg={theme.muted}>
            {`agent ${props.dossier.agent} · mux ${props.dossier.mux}${
              props.dossier.profile === null
                ? ""
                : ` · profile ${props.dossier.profile}`
            } · ${props.dossier.updatedLabel}`}
          </text>
        </box>
      )}
      <box backgroundColor={theme.panelAlt} height={1}>
        <text fg={theme.cyan}>{tabBar}</text>
      </box>
      {
        // All tabs scroll (MIK-069): every line is its own block element
        // inside a vertical scrollbox, so wrapped long entries keep stable
        // row boundaries and content beyond the pane height stays reachable
        // by mouse wheel without touching the global key semantics.
        <scrollbox
          id={DETAIL_BODY_SCROLLBOX_ID}
          scrollY={true}
          scrollX={false}
          height={bodyRows}
          flexGrow={1}
          minHeight={0}
          viewportOptions={{ backgroundColor: theme.panel }}
          contentOptions={{ flexDirection: "column", width: "100%" }}
        >
          {props.lines
            // Lines are positional view state replaced wholesale on each
            // frame, so a position-derived key is stable for exactly as long
            // as the line.
            .map((line, position) => ({ line, key: `${position}:${line}` }))
            .map(({ line, key }) => {
              // Calm-terminal timeline treatment: green incoming, amber
              // outgoing, red only for the durable failed-notification notice.
              const tone =
                activeTab === "messages" ? timelineLineTone(line) : null;
              return (
                <box key={key} width="100%" flexShrink={0}>
                  <text
                    fg={tone === null ? theme.text : timelineAccent(tone)}
                    width="100%"
                  >
                    {line === "" ? " " : line}
                  </text>
                </box>
              );
            })}
        </scrollbox>
      }
      <ActivityStrip activity={props.activity} maxRows={ACTIVITY_MAX_ROWS} />
    </box>
  );
}
