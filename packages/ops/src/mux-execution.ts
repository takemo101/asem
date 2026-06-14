/**
 * Token-scoped mux execution setup for mutating operations.
 *
 * `send_message` and `close_session` both deliver into a Multiplexer pane via a
 * {@link SequenceEngine}, and both must mask the acting Session's raw token from
 * every sequence error, log line, and persisted delivery error (principle 8).
 * They previously re-derived the same redactor + redacted logger + engine trio.
 *
 * {@link muxExecutionFor} builds that trio once from the actor's token:
 * - a token is present (a real current Session): scope the redactor to it;
 * - no token (operator / anonymous human local trust): fall back to the injected
 *   redactor, or `noopRedactor` when the surface supplies none.
 *
 * The surface `Logger` is wrapped with the resolved redactor so any log it emits
 * is redacted (ADR 0006 keeps logger choice at the composition root; this only
 * composes redaction onto whatever logger the surface injected).
 */
import type { Logger, Redactor, TemplateRunner } from "@asem/core";
import {
  createRedactor,
  noopRedactor,
  SequenceEngine,
  withRedaction,
} from "@asem/runtime";

export interface MuxExecutionDeps {
  templateRunner: TemplateRunner;
  logger?: Logger;
  redactor?: Redactor;
}

export interface MuxExecution {
  redactor: Redactor;
  logger?: Logger;
  engine: SequenceEngine;
}

/**
 * Build the redactor, redacted logger, and {@link SequenceEngine} for one mux
 * delivery, scoping the redactor to `token` when a real current Session acts.
 */
export function muxExecutionFor(
  deps: MuxExecutionDeps,
  token: string | null,
): MuxExecution {
  const redactor =
    token === null ? (deps.redactor ?? noopRedactor) : createRedactor([token]);
  const logger =
    deps.logger === undefined
      ? undefined
      : withRedaction(deps.logger, redactor);
  return {
    redactor,
    logger,
    engine: new SequenceEngine({
      runner: deps.templateRunner,
      redactor,
      logger,
    }),
  };
}
