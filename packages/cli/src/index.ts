#!/usr/bin/env bun
/**
 * `@asem/cli` — the installed `asem` binary.
 *
 * Scaffold only (MIK-001). Command parsing and human rendering land in a later
 * slice. The CLI is a surface projection: it parses flags, calls shared
 * `@asem/ops` handlers, and renders results. It must not duplicate semantic
 * operation logic or redefine domain types.
 */
import type { OperationResult } from "@asem/core";

export const PACKAGE_NAME = "@asem/cli";

export type { OperationResult };
