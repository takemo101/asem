/**
 * `@asem/tui` — the human Session cockpit (OpenTUI) and its view models.
 *
 * Scaffold only (MIK-001). The cockpit UI lands in a later slice. The TUI is an
 * operator surface over `@asem/ops` and store snapshots; it inspects, messages,
 * attaches to, closes, and deletes Sessions but does not create them in MVP and
 * does not redefine domain types.
 */
import type { Session } from "@asem/core";

export const PACKAGE_NAME = "@asem/tui";

export type { Session };
