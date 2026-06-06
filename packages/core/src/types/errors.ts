import { z } from "zod";

/**
 * Structured operation error codes.
 *
 * Operations return these for recoverable failures; defects and infrastructure
 * corruption should throw instead. Surfaces render codes differently, but tests
 * assert on codes/details, not prose (see implementation principle 11).
 */
export const operationErrorCodeSchema = z.enum([
  "invalid_input",
  "config_not_found",
  "invalid_config",
  "scope_mismatch",
  "session_not_found",
  "session_name_conflict",
  "parent_session_not_found",
  "current_session_not_found",
  "invalid_session_token",
  "mux_template_not_found",
  "agent_template_not_found",
  "sequence_step_failed",
  "capture_failed",
  "timeout",
  "message_delivery_failed",
]);

export type OperationErrorCode = z.infer<typeof operationErrorCodeSchema>;

export const operationErrorSchema = z
  .object({
    code: operationErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type OperationError = z.infer<typeof operationErrorSchema>;

/** Construct a structured operation error. */
export function operationError(
  code: OperationErrorCode,
  message: string,
  details?: Record<string, unknown>,
): OperationError {
  return details === undefined ? { code, message } : { code, message, details };
}

/**
 * Result envelope for operations that can fail recoverably. `ok` results carry
 * a typed value; `error` results carry a structured {@link OperationError}.
 */
export type OperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OperationError };

export function ok<T>(value: T): OperationResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: OperationError): OperationResult<T> {
  return { ok: false, error };
}
