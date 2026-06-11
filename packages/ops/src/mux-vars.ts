import type { MuxRef } from "@asem/core";

/**
 * Flatten a Session's stored {@link MuxRef} (`Record<string, unknown>`) into
 * string interpolation variables for the mux template sequences (`send`,
 * `close`) and attach rendering. This is the one conversion shared by every
 * operation that replays a stored mux ref, so all of them interpolate the same
 * variables the `create` sequence captured.
 *
 * String values pass through unchanged; any structured value is
 * JSON-stringified so it still interpolates deterministically.
 */
export function muxRefVars(muxRef: MuxRef): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(muxRef)) {
    vars[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return vars;
}
