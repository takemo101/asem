/**
 * `@asem/tui/opentui` — the OpenTUI/React cockpit renderer.
 *
 * Kept behind a subpath export so `@asem/tui`'s root entry (used by tests and
 * any non-TUI surface) never pulls OpenTUI/React in; only the human `asem tui`
 * launch path should import this module (ADR 0004 consequences).
 */
export { CockpitScreen, type CockpitViewStore } from "./app.tsx";
export { OpenTuiCockpitHost } from "./host.tsx";
export { type OpenTuiKey, toKeyEvent } from "./keys.ts";
export { activityAccent, statusAccent, theme } from "./theme.ts";
