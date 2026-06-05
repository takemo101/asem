/**
 * `@asem/store` — SQLite persistence adapter for Sessions and Messages.
 *
 * Owns: schema migrations, row mapping into typed `@asem/core` values, scoped
 * CRUD, and scoped transaction primitives. It does **not** own delete use-case
 * semantics: it exposes `deleteSessionScoped`, `deleteRelatedMessagesScoped`,
 * and `withTransaction` so `@asem/ops` can decide *when* related Messages are
 * removed. All normal queries are scoped by Effective Scope.
 */
import type { Store } from "@asem/core";

export const PACKAGE_NAME = "@asem/store";

export type { Store };

export { SqliteStore, openSqliteStore } from "./sqlite-store.ts";
export type { OpenSqliteStoreOptions } from "./sqlite-store.ts";

export { StoreError, isStoreError } from "./errors.ts";
export type { StoreErrorCode } from "./errors.ts";

export { migrate, LATEST_SCHEMA_VERSION } from "./migrations.ts";

export {
  parseSessionRow,
  parseMessageRow,
  sessionInsertValues,
  messageInsertValues,
} from "./rows.ts";
export type { SessionRow, MessageRow } from "./rows.ts";
