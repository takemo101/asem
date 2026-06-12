/**
 * `@asem/tui` — the human Session cockpit (OpenTUI) and its view models.
 *
 * MIK-012 lands the testable view-model layer; the OpenTUI rendering lands in a
 * later slice. The cockpit is an operator surface over `@asem/ops` and store
 * snapshots: it inspects, messages, attaches to, closes, and deletes Sessions
 * but does not create them in MVP and does not redefine domain types.
 *
 * The layer is split into a pure functional core and a thin ops edge:
 * - {@link createCockpitState}/{@link dispatchCockpit} and the selectors are
 *   I/O-free and drive every behavior (tree, tabs, badges, confirmations);
 * - {@link loadCockpitSnapshot}/{@link executeCockpitEffect} bridge to the
 *   shared `@asem/ops` handlers without duplicating their semantics.
 */
import type { Session } from "@asem/core";

export const PACKAGE_NAME = "@asem/tui";

// In-memory activity projection (snapshot diff → ephemeral activity rows)
export {
  ACTIVITY_CAP,
  type ActivityItem,
  appendActivity,
  type DeliveryResult,
  deliveryResult,
  diffSnapshots,
  newSessionIds,
} from "./activity.ts";
// App orchestration: controller + interactive loop
export {
  AUTO_REFRESH_MS,
  CockpitApp,
  type CockpitAppOptions,
  runCockpit,
  type StepResult,
} from "./app.ts";
// Ops edge: snapshot loading, env resolution, and effect execution
export {
  type AttachDeps,
  type CockpitEffectOutcome,
  type EffectDeps,
  type EnvDeps,
  executeCockpitEffect,
  loadAttach,
  loadCockpitSnapshot,
  resolveCockpitEnv,
  type SnapshotDeps,
} from "./cockpit.ts";
// Host seam (terminal driver interface) + built-in ANSI host
export type { AttachRequest, CockpitHost } from "./host.ts";
// Keyboard mapping
export { type KeyEvent, keyToAction } from "./keymap.ts";
export {
  badgeCount,
  incomingMessages,
  messageRows,
  newIncomingMessageIds,
  observeSession,
  relatedMessages,
  seedBaseline,
  timeLabel,
} from "./messages.ts";
export { contextView, detailView } from "./tabs.ts";
export {
  AnsiCockpitHost,
  type AnsiHostOptions,
  decodeKeys,
  type RenderFrameOptions,
  renderFrame,
  type TtyInput,
  type TtyOutput,
} from "./terminal-host.ts";
// Pure projections
export {
  buildSessionTree,
  filterSessions,
  flattenTree,
} from "./tree.ts";
// View-model types
export * from "./types.ts";
// Render projection (the component layer)
export {
  type ActivityRowView,
  activityRow,
  type CockpitView,
  ERROR_MODAL_MAX_LINES,
  type HeaderView,
  KEYBAR,
  type KeybarItem,
  type LeftPaneView,
  type LeftRow,
  type ModalView,
  renderCockpitView,
  STATUS_SYMBOLS,
  TAB_TITLES,
  type TabHeader,
} from "./view.ts";

// Functional core: state, selectors, reducer
export {
  applySnapshot,
  badgeFor,
  type CreateCockpitStateOptions,
  contextTab,
  createCockpitState,
  detailTab,
  dispatchCockpit,
  messagesTab,
  selectedSession,
  sessionTree,
  visibleSessionRows,
} from "./view-model.ts";
export type { Session };
