import { shellEscape } from "@asem/core";

/**
 * Template variable interpolation for command sequences.
 *
 * Templates reference variables as `{{name}}`. Every variable is available in
 * two forms (implementation principle 9):
 *
 * - `{{name}}` — the raw value;
 * - `{{name_shell}}` — the value passed through the centralized
 *   `@asem/core` `shellEscape` helper.
 *
 * Command strings should use the `_shell` variants; the runtime never invents
 * its own escaping. An explicit variable named exactly `name_shell` takes
 * precedence over the derived shell-escaped form.
 */

export type InterpolationVars = Readonly<Record<string, string>>;

const SHELL_SUFFIX = "_shell";
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Raised when a template references a variable that was not provided. */
export class MissingVariableError extends Error {
  constructor(readonly variable: string) {
    super(`interpolate: missing variable {{${variable}}}`);
    this.name = "MissingVariableError";
  }
}

function resolve(key: string, vars: InterpolationVars): string {
  // Exact match wins, so an explicit `_shell` variable can override the
  // derived escaping if a template author really wants that.
  if (Object.hasOwn(vars, key)) {
    return vars[key] as string;
  }
  if (key.endsWith(SHELL_SUFFIX)) {
    const base = key.slice(0, -SHELL_SUFFIX.length);
    if (Object.hasOwn(vars, base)) {
      return shellEscape(vars[base] as string);
    }
  }
  throw new MissingVariableError(key);
}

/** Interpolate a single template string against the variable map. */
export function interpolate(template: string, vars: InterpolationVars): string {
  return template.replace(PLACEHOLDER, (_match, key: string) =>
    resolve(key, vars),
  );
}

/** Interpolate an optional string, passing through `undefined`. */
export function interpolateOptional(
  template: string | undefined,
  vars: InterpolationVars,
): string | undefined {
  return template === undefined ? undefined : interpolate(template, vars);
}

/** Interpolate every value of a string record (keys are left literal). */
export function interpolateValues(
  record: Readonly<Record<string, string>>,
  vars: InterpolationVars,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = interpolate(value, vars);
  }
  return out;
}
