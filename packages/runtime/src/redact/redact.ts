import type { LogFields, Logger, Redactor } from "@asem/core";

/**
 * Secret redaction for runtime logs and structured failures.
 *
 * Token material must never leak into logs or structured errors (implementation
 * principle 8). The runtime builds a {@link Redactor} from configured secrets
 * and applies it to error messages, error details, and log output before
 * anything leaves the process.
 */

const DEFAULT_REPLACEMENT = "***";

/**
 * Build a {@link Redactor} that masks every configured secret. Empty secrets
 * are ignored; longer secrets are masked first so a secret that contains
 * another is fully covered.
 */
export function createRedactor(
  secrets: readonly string[],
  replacement: string = DEFAULT_REPLACEMENT,
): Redactor {
  const ordered = [...new Set(secrets.filter((s) => s.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  return {
    redact(value: string): string {
      let out = value;
      for (const secret of ordered) {
        out = out.split(secret).join(replacement);
      }
      return out;
    },
  };
}

/** A {@link Redactor} that masks nothing; used when no secrets are configured. */
export const noopRedactor: Redactor = {
  redact: (value) => value,
};

/** Redact every string value in a log/detail field map. */
export function redactFields(redactor: Redactor, fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === "string" ? redactor.redact(value) : value;
  }
  return out;
}

/**
 * Wrap a {@link Logger} so every message and string field is redacted before it
 * reaches the underlying logger.
 */
export function withRedaction(base: Logger, redactor: Redactor): Logger {
  const wrap =
    (level: keyof Logger) =>
    (message: string, fields?: LogFields): void => {
      base[level](
        redactor.redact(message),
        fields ? redactFields(redactor, fields) : undefined,
      );
    };
  return {
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}

export interface LogEntry {
  level: keyof Logger;
  message: string;
  fields?: LogFields;
}

/**
 * In-memory {@link Logger} for tests: records every entry so tests can assert
 * on emitted messages and verify redaction.
 */
export function createMemoryLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record =
    (level: keyof Logger) =>
    (message: string, fields?: LogFields): void => {
      entries.push(fields ? { level, message, fields } : { level, message });
    };
  return {
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    entries,
  };
}
