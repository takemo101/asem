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

export type { StoreErrorCode } from "./errors.ts";
export { isStoreError, StoreError } from "./errors.ts";
export { LATEST_SCHEMA_VERSION, migrate } from "./migrations.ts";
export type { MessageRow, SessionRow } from "./rows.ts";
export {
  messageInsertValues,
  parseMessageRow,
  parseSessionRow,
  sessionInsertValues,
} from "./rows.ts";
export type { OpenSqliteStoreOptions } from "./sqlite-store.ts";
export { openSqliteStore, SqliteStore } from "./sqlite-store.ts";
export type { Store };
