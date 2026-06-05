/**
 * Static usage text for the `asem` CLI.
 *
 * Help is rendered without touching any operation deps, so `asem`, `asem --help`,
 * and per-group help work even before runtime adapters are wired.
 */

const ROOT_USAGE = [
  "asem — local agent Session manager",
  "",
  "usage: asem <command> [options]",
  "",
  "commands:",
  "  init --workspace <id>            initialize an asem project in this worktree",
  "  init-session --name <name> --mux-ref <json> [--agent <a>] [--mux <m>] [--root|--parent <id>]",
  "                                   register the current agent as a Session and print shell exports",
  "  session list [--status <s>] [--parent <id>] [--refresh] [--json]",
  "                                   list Sessions in the current scope",
  "  session get <id> [--refresh] [--json]",
  "                                   show one Session",
  "  session attach <id>             print attach guidance for a Session (human only)",
  "  message list [--to <id>] [--inbox] [--undelivered] [--json]",
  "                                   list Message history in the current scope",
  "",
  "global:",
  "  -h, --help                      show this help",
];

const INIT_SESSION_USAGE = [
  "asem init-session — register the current agent as a Session",
  "",
  "usage: asem init-session --name <name> --mux-ref <json> [options]",
  "",
  "options:",
  "  --name <name>        Session name (required)",
  "  --mux-ref <json>     multiplexer coordinates as a JSON object (required)",
  "  --agent <agent>      agent template (defaults to config)",
  "  --mux <mux>          mux template (defaults to config)",
  "  --root               register as a root Session (no parent)",
  "  --parent <id>        register under an explicit parent Session",
  "  --json               print machine-readable JSON instead of shell exports",
];

/** Usage lines for an optional command group, falling back to root usage. */
export function usageFor(topic?: string): string[] {
  switch (topic) {
    case "init-session":
      return INIT_SESSION_USAGE;
    default:
      return ROOT_USAGE;
  }
}
