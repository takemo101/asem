/**
 * `@asem/integrations` — CLI-only Integration Target MCP and Skill installers.
 *
 * This package owns the target registries, MCP config adapters, Skill path
 * adapters, the shared asem Skill document, and atomic file writes. It is not
 * exposed through `@asem/mcp`: Integration Target setup mutates local human
 * toolchain configuration and stays a human-triggered CLI operation.
 */
export * from "./shared.ts";
