/**
 * `@asem/runtime` — template registry, template interpolation, command
 * sequence execution, capture handling, and the fake runner contract.
 *
 * Scaffold only (MIK-001). Behavior lands in a later slice. This package builds
 * on `@asem/core` contracts and must not redefine domain types; shell escaping
 * uses the `@asem/core` primitive rather than a local implementation.
 */
import type {
  TemplateRunner,
  TemplateRegistry,
  CommandRunner,
} from "@asem/core";

export const PACKAGE_NAME = "@asem/runtime";

export type { TemplateRunner, TemplateRegistry, CommandRunner };
