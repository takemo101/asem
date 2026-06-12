/**
 * The OpenTUI cockpit screen: a purely presentational React tree over the
 * latest {@link CockpitView}.
 *
 * The pure view-model and `CockpitApp` remain the source of behavior (design
 * "Renderer"; ADR 0004): this component never calls `@asem/ops`. It subscribes
 * to the host's last-drawn view, forwards keyboard input back into the host's
 * key queue, and lays out header / panels / footer with fixed chrome and
 * `minHeight: 0` scroll regions so resizes never overlap the footer.
 */
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { KeyEvent } from "../keymap.ts";
import type { CockpitView } from "../view.ts";
import { DetailPane } from "./components/detail-pane.tsx";
import { Footer, FOOTER_HEIGHT } from "./components/footer.tsx";
import { Header } from "./components/header.tsx";
import { ModalDialog } from "./components/modal.tsx";
import { SessionList } from "./components/session-list.tsx";
import { toKeyEvent } from "./keys.ts";
import { theme } from "./theme.ts";

/** The host-side store the screen renders from (implemented by the host). */
export interface CockpitViewStore {
  subscribe(listener: () => void): () => void;
  getView(): CockpitView | null;
  pushKey(event: KeyEvent): void;
}

/** Rows of fixed chrome around the panels: header + footer + panel borders. */
const HEADER_HEIGHT = 1;
const PANEL_VERTICAL_CHROME_ROWS = 3;
const FIXED_CHROME_ROWS =
  HEADER_HEIGHT + FOOTER_HEIGHT + PANEL_VERTICAL_CHROME_ROWS;

export function CockpitScreen(props: { store: CockpitViewStore }): ReactNode {
  const { store } = props;
  const view = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getView(),
  );
  const terminal = useTerminalDimensions();
  useKeyboard((key) => {
    const event = toKeyEvent(key);
    if (event !== null) {
      store.pushKey(event);
    }
  });

  if (view === null) {
    return null;
  }
  const paneRows = Math.max(1, terminal.height - FIXED_CHROME_ROWS);
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.bg}
    >
      <Header header={view.header} />
      <box
        flexDirection="row"
        flexGrow={1}
        minHeight={0}
        gap={1}
        backgroundColor={theme.bg}
      >
        <SessionList left={view.left} maxVisibleRows={paneRows} />
        <DetailPane
          tabs={view.tabs}
          lines={view.right}
          activity={view.activity}
          maxVisibleRows={paneRows}
        />
      </box>
      {view.modal === null ? null : <ModalDialog modal={view.modal} />}
      <Footer
        keybar={view.keybar}
        statusLine={view.statusLine}
        autoLabel={view.header.autoLabel}
      />
    </box>
  );
}
