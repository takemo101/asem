/**
 * `@asem/store` — SQLite migrations, row mapping, scoped Session/Message CRUD,
 * and scoped transaction primitives.
 *
 * Scaffold only (MIK-001). The concrete SQLite implementation lands in a later
 * slice and will satisfy the `Store` port from `@asem/core`. Delete use-case
 * semantics live in `@asem/ops`, not here.
 */
import type { Store } from "@asem/core";

export const PACKAGE_NAME = "@asem/store";

export type { Store };
