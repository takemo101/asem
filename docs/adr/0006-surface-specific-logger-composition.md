# ADR 0006: Logger implementations are selected by surface

## Status

Accepted for implementation planning.

## Context

`Logger` is a shared operation port, but CLI, MCP, and TUI have different output safety constraints. CLI can write diagnostics to stderr, MCP stdout is reserved for JSON-RPC protocol messages, and the TUI must not let operation logs write directly to the terminal while the cockpit renderer owns the screen.

The previous real composition root built one `OpsDeps` bundle with a stderr JSON `ConsoleLogger` and reused it for all surfaces. A TUI edge workaround suppressed logs for mutation effects, but that hid the policy in the cockpit instead of making the surface boundary explicit.

## Decision

Real runtime dependency composition must choose the logger implementation by surface.

`createRuntimeDeps` takes a required surface (`cli`, `mcp`, or `tui`) and uses an internal surface logger factory:

- CLI receives the existing stderr JSON `ConsoleLogger`.
- MCP receives a silent logger by default; it must not emit unsolicited logs to protocol stdout or stderr.
- TUI receives a silent logger by default; cockpit status and errors are rendered in-band, not through terminal log lines.

No external logging library, debug file, telemetry, or environment-controlled log mode is added in this slice. The shared `Logger` port remains the seam, so a future implementation can put a richer logger behind the same port if there is a concrete need.

## Consequences

- Surface safety is enforced at the composition root instead of inside operation handlers.
- `@asem/ops` continues to depend only on the shared `Logger` port and does not learn about CLI, MCP, or TUI.
- The TUI cockpit no longer needs a local operation-log suppression wrapper for normal runtime composition.
- MCP favors protocol safety and quiet operation over default diagnostic logs.
- Any logger that can emit externally must preserve existing redaction behavior.

## Rejected alternatives

### Add pino, winston, consola, or another logger library now

Rejected. MIK-033 is about choosing the right logger implementation per surface, not about logger feature depth. Adding a library would increase dependency and configuration surface without solving the composition-boundary problem.

### Keep suppressing logs inside the TUI cockpit

Rejected. It is useful as a short-term workaround, but it makes logger policy a TUI effect concern. The durable boundary is that the TUI runtime receives safe deps.

### Add debug files or environment-controlled logging for MCP/TUI

Rejected for this slice. Those are useful diagnostic features, but they need their own path, redaction, lifecycle, and test design. MIK-033 keeps MCP/TUI silent by default.
