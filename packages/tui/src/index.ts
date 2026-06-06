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

// Ops edge: snapshot loading and effect execution
export {
  type CockpitEffectOutcome,
  type EffectDeps,
  executeCockpitEffect,
  loadCockpitSnapshot,
  type SnapshotDeps,
} from "./cockpit.ts";
export {
  badgeCount,
  incomingMessages,
  messageRows,
  newIncomingMessageIds,
  observeSession,
  relatedMessages,
  seedBaseline,
} from "./messages.ts";
export { contextView, detailView } from "./tabs.ts";
// Pure projections
export {
  buildSessionTree,
  filterSessions,
  flattenTree,
} from "./tree.ts";
// View-model types
export * from "./types.ts";

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
