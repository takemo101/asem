/**
 * Static help text for the `asem` CLI.
 *
 * Help is rendered without touching any operation deps, so `asem`, `asem --help`,
 * per-group help, and per-command help all work even before runtime adapters are
 * wired. Each focused page separates usage, required arguments/options, optional
 * options, examples, and notes so a reader can scan one command at a time instead
 * of inferring everything from a single dense root listing.
 *
 * Domain vocabulary is used precisely (Session, Message, Report, Workspace,
 * Worktree Root, Effective Scope, Multiplexer, Agent, Template, Init Wizard,
 * Cockpit). When the user is choosing templates the text says "Agent Template"
 * and "Multiplexer Template" so it never implies a live Agent or Multiplexer.
 */

/** Root help: a scannable command map grouped by purpose, not a flat list. */
const ROOT_USAGE = [
  "asem — local agent Session manager",
  "",
  "usage: asem <command> [options]",
  "       asem <command> --help        focused help for one command",
  "",
  "Common workflows:",
  "  asem init --interactive",
  "  asem doctor",
  "  asem init-session --name <name> --mux-ref '<json>'",
  "  asem session create <name> --prompt <text>",
  "  asem tui",
  "",
  "Setup:",
  "  init            initialize an asem Workspace in this Worktree Root",
  "  init-session    register the current agent process as a Session",
  "",
  "Sessions:",
  "  session create  create and launch a child Session",
  "  session list    list Sessions in the Effective Scope",
  "  session get     show one Session",
  "  session attach  attach to a Session's Multiplexer pane (human only)",
  "  session close   close a Session's pane/process and mark it closed",
  "  session delete  delete a Session and its Messages (destructive)",
  "",
  "Profiles:",
  "  profile list    list Agent Profiles for `session create --profile`",
  "  profile get     show one Agent Profile's instructions",
  "",
  "Messages:",
  "  message list    list Message history in the Effective Scope",
  "  message wait    wait for a Message or Report",
  "  message send    send a Message to a Session",
  "  report parent   report to the current Session's parent Session",
  "",
  "Surfaces:",
  "  tui             open the human Cockpit",
  "  mcp             start the AI-facing MCP server",
  "",
  "Global options:",
  "  -h, --help      show this help",
  "",
  "Run `asem <command> --help` for usage, options, and examples.",
];

/** Group help: orient on a noun, then point at its subcommands' focused pages. */
const SESSION_GROUP_USAGE = [
  "asem session — manage child Sessions in the Effective Scope",
  "",
  "usage: asem session <subcommand> [options]",
  "",
  "subcommands:",
  "  create   create and launch a child Session",
  "  list     list Sessions in the Effective Scope",
  "  get      show one Session",
  "  attach   attach to a Session's Multiplexer pane (human only)",
  "  close    close a Session's pane/process and mark it closed",
  "  delete   delete a Session and its Messages (destructive)",
  "",
  "Run `asem session <subcommand> --help` for usage, options, and examples.",
];

const MESSAGE_GROUP_USAGE = [
  "asem message — exchange Messages between Sessions in the Effective Scope",
  "",
  "usage: asem message <subcommand> [options]",
  "",
  "subcommands:",
  "  list   list Message history in the Effective Scope",
  "  wait   wait for a Message or Report to arrive",
  "  send   send a Message to a Session",
  "",
  "Run `asem message <subcommand> --help` for usage, options, and examples.",
];

const REPORT_GROUP_USAGE = [
  "asem report — send a Report up the Session tree",
  "",
  "usage: asem report <subcommand> [options]",
  "",
  "subcommands:",
  "  parent   report to the current Session's parent Session",
  "",
  "Run `asem report parent --help` for usage, options, and examples.",
];

// --- focused command pages -------------------------------------------------

const INIT_USAGE = [
  "asem init — initialize an asem Workspace in this Worktree Root",
  "",
  "usage:",
  "  asem init --interactive",
  "  asem init --workspace <id> --agent <name> --mux <name>",
  "",
  "options:",
  "  --interactive       run the Init Wizard to pick the Workspace and Templates",
  "  --workspace <id>    Workspace id for non-interactive setup",
  "  --agent <name>      default Agent Template (must be paired with --mux)",
  "  --mux <name>        default Multiplexer Template (must be paired with --agent)",
  "",
  "examples:",
  "  asem init --interactive",
  "  asem init --workspace acme --agent pi --mux tmux",
  "",
  "notes:",
  "  Re-running init on an existing config leaves it unchanged.",
  "  --interactive needs a TTY; otherwise pass --workspace/--agent/--mux.",
  "  --agent and --mux must be provided together for non-interactive setup.",
];

const DOCTOR_USAGE = [
  "asem doctor — check local Agent and Multiplexer command availability",
  "",
  "usage:",
  "  asem doctor [--json]",
  "",
  "options:",
  "  --json    print machine-readable JSON",
  "",
  "examples:",
  "  asem doctor",
  "  asem doctor --json",
  "",
  "notes:",
  "  Missing executables are diagnostics, not command failures; exit code stays 0.",
  "  The first version checks builtin Agent and Multiplexer Template commands only.",
];

const INIT_SESSION_USAGE = [
  "asem init-session — register the current agent process as a Session",
  "",
  "usage:",
  "  asem init-session --name <name> --mux-ref '<json>' [options]",
  "",
  "required:",
  "  --name <name>       Session name (unique in the Effective Scope)",
  "  --mux-ref '<json>'  Multiplexer coordinates as a JSON object, so the",
  '                      Session is deliverable (e.g. \'{"pane":"p1"}\')',
  "",
  "options:",
  "  --agent <name>      Agent Template label (defaults to config)",
  "  --mux <name>        Multiplexer Template label (defaults to config)",
  "  --root              register as a root Session (no parent)",
  "  --parent <id>       register under an explicit parent Session",
  "  --json              print machine-readable JSON instead of shell exports",
  "",
  "examples:",
  '  eval "$(asem init-session --name reviewer-1 --mux-ref \'{"pane":"p1"}\' --root)"',
  "  asem init-session --name child-1 --mux-ref '{}' --parent s_parent --json",
  "",
  "notes:",
  "  Prints AS_SESSION_ID / AS_SESSION_TOKEN / AS_WORKSPACE_ID / AS_WORKTREE_ROOT",
  "  exports; eval them so later commands run as this Session.",
  "  --root and --parent are mutually exclusive.",
];

const SESSION_CREATE_USAGE = [
  "asem session create — create and launch a child Session",
  "",
  "usage:",
  "  asem session create <name> --prompt <text> [options]",
  "",
  "required:",
  "  <name>             Session name (unique in the Effective Scope)",
  "  --prompt <text>    initial prompt handed to the launched Agent",
  "",
  "options:",
  "  --agent <name>     Agent Template to launch (defaults to config)",
  "  --mux <name>       Multiplexer Template to host the pane (defaults to config)",
  "  --model <model>    model value passed through the Agent Template",
  "                     {{model_shell}} (fails if the selected Agent Template",
  "                     does not support models)",
  "  --profile <id>     Agent Profile to shape the prompt (see `asem profile list`)",
  "  --cwd <dir>        working directory for the child (defaults to current)",
  "  --root             create as a root Session (no parent)",
  "  --parent <id>      create under an explicit parent Session",
  "  --json             print the created Session as JSON",
  "",
  "examples:",
  "  asem session create reviewer-1 --prompt 'review PR #42'",
  "  asem session create build --prompt 'run CI' --agent codex --mux tmux",
  "  asem session create reviewer-2 --prompt 'review' --agent claude --model sonnet",
  "  asem session create reviewer-3 --prompt 'review the diff' --profile reviewer",
  "",
  "notes:",
  "  Without --root or --parent, the child is parented to the current Session.",
  "  --root and --parent are mutually exclusive.",
  "  Model support is Agent-Template-dependent; builtin agy is model-unsupported.",
  "  --profile shapes prompt.md (profile instructions first, your prompt second);",
  "  the profile may also set default --agent/--model, but explicit flags win.",
];

const PROFILE_GROUP_USAGE = [
  "asem profile — inspect Agent Profiles available for `session create`",
  "",
  "usage: asem profile <subcommand> [options]",
  "",
  "subcommands:",
  "  list   list Agent Profiles (project, user, and builtin)",
  "  get    show one Agent Profile's metadata and full instructions",
  "",
  "Run `asem profile <subcommand> --help` for usage, options, and examples.",
];

const PROFILE_LIST_USAGE = [
  "asem profile list — list available Agent Profiles",
  "",
  "usage:",
  "  asem profile list [--json]",
  "",
  "options:",
  "  --json    print the Agent Profiles as JSON",
  "",
  "examples:",
  "  asem profile list",
  "",
  "notes:",
  "  Profiles resolve project > user > builtin; a project or user profile fully",
  "  replaces a builtin of the same id. Files live under .asem/agents/*.md.",
];

const PROFILE_GET_USAGE = [
  "asem profile get — show one Agent Profile with its full instructions",
  "",
  "usage:",
  "  asem profile get <id> [--json]",
  "",
  "required:",
  "  <id>      Agent Profile id (see `asem profile list`)",
  "",
  "options:",
  "  --json    print the Agent Profile as JSON",
  "",
  "examples:",
  "  asem profile get reviewer",
];

const SESSION_LIST_USAGE = [
  "asem session list — list Sessions in the Effective Scope",
  "",
  "usage:",
  "  asem session list [options]",
  "",
  "options:",
  "  --status <status>  filter by Session status (e.g. running, closed)",
  "  --parent <id>      filter to children of one parent Session",
  "  --refresh          refresh liveness from the Multiplexer before listing",
  "  --json             print the Sessions as JSON",
  "",
  "examples:",
  "  asem session list",
  "  asem session list --status running --refresh",
];

const SESSION_GET_USAGE = [
  "asem session get — show one Session",
  "",
  "usage:",
  "  asem session get <id> [options]",
  "",
  "required:",
  "  <id>          Session id",
  "",
  "options:",
  "  --refresh     refresh liveness from the Multiplexer before showing",
  "  --json        print the Session as JSON",
  "",
  "examples:",
  "  asem session get s_1",
  "  asem session get s_1 --refresh --json",
];

const SESSION_ATTACH_USAGE = [
  "asem session attach — attach to a Session's Multiplexer pane (human only)",
  "",
  "usage:",
  "  asem session attach <id> [options]",
  "",
  "required:",
  "  <id>        Session id",
  "",
  "options:",
  "  --json      print the attach command/hint as JSON instead of attaching",
  "",
  "examples:",
  "  asem session attach s_1",
  "",
  "notes:",
  "  Attaches the current terminal to the Session's live Multiplexer pane.",
];

const SESSION_CLOSE_USAGE = [
  "asem session close — close a Session's pane/process and mark it closed",
  "",
  "usage:",
  "  asem session close <id> [options]",
  "",
  "required:",
  "  <id>        Session id",
  "",
  "options:",
  "  --json      print the closed Session as JSON",
  "",
  "examples:",
  "  asem session close s_1",
];

const SESSION_DELETE_USAGE = [
  "asem session delete — delete a Session and its Messages (destructive)",
  "",
  "usage:",
  "  asem session delete <id> --force [options]",
  "",
  "required:",
  "  <id>        Session id",
  "  --force     confirm the destructive delete (alias: --yes)",
  "",
  "options:",
  "  --json      print the deletion summary as JSON",
  "",
  "examples:",
  "  asem session delete s_1 --force",
  "",
  "notes:",
  "  Deletes the Session and every Message addressed to or from it.",
  "  Without --force the operation refuses and exits with a usage error.",
];

const MESSAGE_LIST_USAGE = [
  "asem message list — list Message history in the Effective Scope",
  "",
  "usage:",
  "  asem message list [options]",
  "",
  "options:",
  "  --to <id>        list Messages addressed to one Session",
  "  --inbox          list Messages addressed to the current Session",
  "  --undelivered    list only Messages not yet delivered",
  "  --json           print the Messages as JSON",
  "",
  "examples:",
  "  asem message list",
  "  asem message list --inbox --undelivered",
];

const MESSAGE_WAIT_USAGE = [
  "asem message wait — wait for a Message or Report to arrive",
  "",
  "usage:",
  "  asem message wait --to <id> [options]",
  "",
  "required:",
  "  --to <id>            target Session id (also accepted as a positional)",
  "",
  "options:",
  "  --from <id>          only match Messages from one Session",
  "  --kind <kind>        match message or report (default: any)",
  "  --timeout-ms <n>     give up after n milliseconds (default: 600000)",
  "  --poll-ms <n>        poll interval in milliseconds (default: 1000)",
  "  --json               print the matched Message as JSON",
  "",
  "examples:",
  "  asem message wait --to s_parent --from s_child --kind report",
  "  asem message wait --to s_1 --timeout-ms 30000 --poll-ms 500",
  "",
  "notes:",
  "  Exits successfully on the first match, or with a timeout error.",
];

const MESSAGE_SEND_USAGE = [
  "asem message send — send a Message to a Session",
  "",
  "usage:",
  "  asem message send <id> --body <text> [options]",
  "",
  "required:",
  "  <id>            target Session id (also accepted as --to <id>)",
  "  --body <text>   Message body",
  "",
  "options:",
  "  --json          print the delivered Message as JSON",
  "",
  "examples:",
  "  asem message send s_1 --body 'ready for review'",
  "  asem message send --to s_1 --body 'ping' --json",
];

const REPORT_PARENT_USAGE = [
  "asem report parent — report to the current Session's parent Session",
  "",
  "usage:",
  "  asem report parent --body <text> [options]",
  "",
  "required:",
  "  --body <text>   Report body",
  "",
  "options:",
  "  --json          print the delivered Report as JSON",
  "",
  "examples:",
  "  asem report parent --body 'halfway done'",
  "",
  "notes:",
  "  Sends a Report Message to the parent of the current Session.",
];

const MCP_USAGE = [
  "asem mcp — start the AI-facing MCP server",
  "",
  "usage:",
  "  asem mcp",
  "",
  "notes:",
  "  Serves the asem tools over stdio for an MCP client; it runs until the",
  "  client disconnects. Operations stay scoped to the current Worktree Root.",
];

const TUI_USAGE = [
  "asem tui — open the human Cockpit",
  "",
  "usage:",
  "  asem tui [--scope worktree|workspace]",
  "",
  "options:",
  "  --scope worktree    show only Sessions in the current Worktree Root",
  "  --scope workspace   show every Session in the Workspace (default)",
  "",
  "examples:",
  "  asem tui",
  "  asem tui --scope worktree",
  "",
  "notes:",
  "  The Cockpit defaults to the workspace-wide view; only the human TUI",
  "  broadens scope. Plain CLI and MCP operations stay worktree-isolated.",
];

/** Focused pages keyed by their command path (`group subcommand` or command). */
const PAGES: Record<string, string[]> = {
  session: SESSION_GROUP_USAGE,
  profile: PROFILE_GROUP_USAGE,
  message: MESSAGE_GROUP_USAGE,
  report: REPORT_GROUP_USAGE,
  init: INIT_USAGE,
  doctor: DOCTOR_USAGE,
  "init-session": INIT_SESSION_USAGE,
  "session create": SESSION_CREATE_USAGE,
  "session list": SESSION_LIST_USAGE,
  "session get": SESSION_GET_USAGE,
  "session attach": SESSION_ATTACH_USAGE,
  "session close": SESSION_CLOSE_USAGE,
  "session delete": SESSION_DELETE_USAGE,
  "profile list": PROFILE_LIST_USAGE,
  "profile get": PROFILE_GET_USAGE,
  "message list": MESSAGE_LIST_USAGE,
  "message wait": MESSAGE_WAIT_USAGE,
  "message send": MESSAGE_SEND_USAGE,
  "report parent": REPORT_PARENT_USAGE,
  mcp: MCP_USAGE,
  tui: TUI_USAGE,
};

/**
 * Help lines for a topic, falling back to the root command map.
 *
 * `topic` is a command path such as `session`, `session create`, `tui`, or
 * `init-session`. An unknown or absent topic returns the root help so help never
 * masks a real command — invalid commands still flow through the parser's
 * `invalid_input` path, not here.
 */
export function usageFor(topic?: string): string[] {
  if (topic === undefined) return ROOT_USAGE;
  return PAGES[topic] ?? ROOT_USAGE;
}
