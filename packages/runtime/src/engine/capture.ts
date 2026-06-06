import type { CaptureSpec } from "../template/schema.ts";

/**
 * Capture extraction for `run` steps.
 *
 * A capture reads from a step's stdout or stderr and extracts a single string
 * value, either by regular expression or by a small JSONPath subset. A capture
 * that does not match is a recoverable failure (`capture_failed`), not a throw.
 */

export type CaptureOutcome =
  | { ok: true; value: string }
  | { ok: false; reason: string };

function sourceText(spec: CaptureSpec, stdout: string, stderr: string): string {
  return spec.source === "stderr" ? stderr : stdout;
}

function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Apply one capture spec against a step's output. */
export function applyCapture(
  spec: CaptureSpec,
  stdout: string,
  stderr: string,
): CaptureOutcome {
  const text = sourceText(spec, stdout, stderr);
  if ("regex" in spec) {
    return captureRegex(spec.regex, spec.group ?? 0, text);
  }
  return captureJsonPath(spec.jsonpath, text);
}

function captureRegex(
  pattern: string,
  group: number,
  text: string,
): CaptureOutcome {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (error) {
    return { ok: false, reason: `invalid regex: ${String(error)}` };
  }
  const match = re.exec(text);
  if (match === null) {
    return { ok: false, reason: "regex did not match" };
  }
  const captured = match[group];
  if (captured === undefined) {
    return { ok: false, reason: `regex group ${group} not captured` };
  }
  return { ok: true, value: captured };
}

function captureJsonPath(path: string, text: string): CaptureOutcome {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, reason: "source is not valid JSON" };
  }
  const result = evaluateJsonPath(path, root);
  if (!result.found) {
    return { ok: false, reason: `jsonpath ${path} did not match` };
  }
  if (result.value === undefined) {
    return { ok: false, reason: `jsonpath ${path} resolved to undefined` };
  }
  return { ok: true, value: stringify(result.value) };
}

type JsonPathResult = { found: false } | { found: true; value: unknown };

const IDENT_CHAR = /[A-Za-z0-9_]/;

/**
 * Evaluate a minimal JSONPath subset against a parsed JSON value.
 *
 * Supported syntax: a leading `$`, dotted keys (`.foo`), bracketed quoted keys
 * (`['foo']` / `["foo"]`), and numeric array indexes (`[0]`). Wildcards,
 * filters, recursion, and slices are intentionally out of scope for the MVP.
 */
export function evaluateJsonPath(path: string, root: unknown): JsonPathResult {
  if (path.length === 0 || path[0] !== "$") {
    return { found: false };
  }
  let i = 1;
  let current: unknown = root;

  const descend = (key: string): boolean => {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    if (!Object.hasOwn(current, key)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
    return true;
  };

  const indexInto = (idx: number): boolean => {
    if (!Array.isArray(current) || idx < 0 || idx >= current.length) {
      return false;
    }
    current = current[idx];
    return true;
  };

  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      i += 1;
      let key = "";
      while (i < path.length && IDENT_CHAR.test(path[i] as string)) {
        key += path[i];
        i += 1;
      }
      if (key.length === 0 || !descend(key)) {
        return { found: false };
      }
    } else if (ch === "[") {
      i += 1;
      const quote = path[i];
      if (quote === "'" || quote === '"') {
        i += 1;
        let key = "";
        while (i < path.length && path[i] !== quote) {
          key += path[i];
          i += 1;
        }
        if (path[i] !== quote) {
          return { found: false };
        }
        i += 1;
        if (path[i] !== "]") {
          return { found: false };
        }
        i += 1;
        if (!descend(key)) {
          return { found: false };
        }
      } else {
        let digits = "";
        while (i < path.length && path[i] !== "]") {
          digits += path[i];
          i += 1;
        }
        if (path[i] !== "]" || digits.length === 0) {
          return { found: false };
        }
        i += 1;
        const idx = Number(digits);
        if (!Number.isInteger(idx) || !indexInto(idx)) {
          return { found: false };
        }
      }
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}
