/**
 * Template resolution at the `@asem/ops` boundary.
 *
 * Builtin and project-local template definitions are parsed by the
 * `@asem/runtime` registry, which *throws* a schema error when a definition is
 * malformed. A malformed project-local template (from a `.asem.yaml`) is a
 * recoverable local configuration defect, not a defect in asem itself, so the
 * exception must not escape an operation as an internal JSON-RPC error
 * (design principle 12 "Error Semantics over Exceptions"; MIK-026).
 *
 * These helpers run at the operation boundary and convert that thrown/parsed
 * schema error into a structured {@link OperationError} with code
 * `invalid_template`. A *missing* name resolves to `ok(undefined)` so callers
 * keep their existing missing-template behavior — `mux_template_not_found` /
 * `agent_template_not_found` for required templates, or the best-effort
 * delivery/attach fallback where a template is optional. Only a present but
 * invalid definition becomes `invalid_template`.
 *
 * Error details carry only the template kind, the requested name, and the
 * schema issue messages (structural descriptions). Raw template values and any
 * secrets are never copied into the details (principle 8 / security rules).
 */
import {
  err,
  type OperationError,
  type OperationResult,
  ok,
  operationError,
  type TemplateRegistry,
} from "@asem/core";
import {
  type AgentTemplate,
  agentTemplateSchema,
  type MuxTemplate,
  muxTemplateSchema,
} from "@asem/runtime";

type TemplateKind = "mux" | "agent";

/** Structurally-typed schema view: only `safeParse` is needed here. */
type SafeParser<T> = {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
};

/**
 * Resolve a mux template by name. Returns `ok(undefined)` for a missing name,
 * the parsed {@link MuxTemplate} for a valid one, or an `invalid_template`
 * error for a malformed definition.
 */
export function resolveMuxTemplate(
  registry: TemplateRegistry,
  name: string,
): OperationResult<MuxTemplate | undefined> {
  return resolveTemplate(
    "mux",
    name,
    () => registry.getMuxTemplate(name),
    muxTemplateSchema,
  );
}

/**
 * Resolve an agent template by name. Returns `ok(undefined)` for a missing
 * name, the parsed {@link AgentTemplate} for a valid one, or an
 * `invalid_template` error for a malformed definition.
 */
export function resolveAgentTemplate(
  registry: TemplateRegistry,
  name: string,
): OperationResult<AgentTemplate | undefined> {
  return resolveTemplate(
    "agent",
    name,
    () => registry.getAgentTemplate(name),
    agentTemplateSchema,
  );
}

function resolveTemplate<T>(
  kind: TemplateKind,
  name: string,
  read: () => unknown,
  schema: SafeParser<T>,
): OperationResult<T | undefined> {
  // The registry parses on read, so a malformed definition throws here.
  let raw: unknown;
  try {
    raw = read();
  } catch (error) {
    return err(invalidTemplateError(kind, name, error));
  }
  if (raw === undefined || raw === null) {
    return ok(undefined);
  }
  // Re-validate the opaque port value, also catching a registry that returns
  // (rather than throws) an unparsed definition.
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return err(invalidTemplateError(kind, name, parsed.error));
  }
  return ok(parsed.data);
}

function invalidTemplateError(
  kind: TemplateKind,
  name: string,
  error: unknown,
): OperationError {
  const issues = schemaIssues(error);
  return operationError(
    "invalid_template",
    `invalid ${kind} template definition: ${name}`,
    { kind, name, ...(issues !== undefined ? { issues } : {}) },
  );
}

/**
 * Extract zod-style issue messages without importing zod or copying received
 * values. Works for both a thrown `ZodError` and a `safeParse` error.
 */
function schemaIssues(error: unknown): string[] | undefined {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) {
    return undefined;
  }
  const messages = issues
    .map((issue) => (issue as { message?: unknown } | null)?.message)
    .filter((message): message is string => typeof message === "string");
  return messages.length > 0 ? messages : undefined;
}
