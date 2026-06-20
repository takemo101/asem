/**
 * The shared asem Skill document.
 *
 * One document is installed for every Integration Target; only the target's file
 * convention differs. It teaches an external AI client to treat asem as a local
 * Session manager, to prefer asem MCP tools and fall back to the CLI, and to
 * respect asem's domain boundary (Session status is not task success). The
 * SKILL.md frontmatter follows the convention shared by clients with first-class
 * Skills.
 */
const frontmatter = `---
name: asem
description: asem is a local Session manager for AI agents running in terminal multiplexers. Use it to create, find, message, report from, attach to, close, and inspect local Sessions without inventing task or workflow outcomes.
---`;

const body = `# asem

asem is a local agent Session manager. It manages live AI CLI Sessions running inside terminal multiplexers and records durable Messages and Reports.

Prefer asem MCP tools when they are available. Fall back to the \`asem\` CLI when MCP is unavailable.

## Vocabulary

Use these terms precisely:

- Session: a registered agent CLI process running inside a Multiplexer pane.
- Message: durable communication from one Session or human operator to another Session.
- Report: a Message from a child Session to its Parent Session.
- Workspace: a logical grouping for related work.
- Worktree Root: the filesystem root that isolates a working copy.
- Effective Scope: Workspace plus Worktree Root.
- Multiplexer: the terminal environment that owns a live pane, such as herdr, tmux, rmux, or zellij.
- Agent: the external AI CLI process launched inside a Session.
- Agent Profile: explicit prompt-shaping instructions for a new Session.
- Integration Target: an external AI client whose local config can be updated to know how to use asem.

## Normal Session operation

- Create child Sessions for bounded units of work, not for the whole job at once.
- Send Messages for follow-up instructions, questions, or context to an existing Session.
- A child Session reports progress, findings, and questions back to its Parent Session with \`report_parent\`. A Report is communication, not a completion signal.
- For non-trivial implementation, use separate worker and reviewer Sessions so review is independent of the work.
- Close child Sessions once their work, review, and merge are done.
- Preserve history: do not delete Sessions unless you are explicitly cleaning up history. Closing a Session keeps its Messages and Reports; deleting discards them.

## MCP-first, CLI fallback

Prefer asem MCP tools when they are available. Fall back to the \`asem\` CLI when MCP is unavailable. Common CLI equivalents:

- \`asem session create\` — create a Session (optionally a child of the current one).
- \`asem message send\` — send a Message to a Session.
- \`asem message wait\` — wait for a Message or Report.
- \`asem report parent\` — report from a child Session to its Parent Session.
- \`asem session close\` — close a Session while preserving its history.
- \`asem workspace repo list\` — list Repo Aliases defined for the Workspace.

Do not edit \`.asem\` runtime state files directly. In particular, do not edit token-bearing or generated state under \`.asem/sessions/\`, \`.asem/tokens/\`, or \`.asem/current-session*.json\`.

## Workspace-root and Repo Alias operation

A Workspace-root \`.asem.yaml\` may define \`repos\`: named Repo Aliases that map to repository directories.

- \`asem workspace repo list\` lists the available Repo Aliases.
- \`asem session create <name> --repo <alias> --root --prompt ...\` creates a repo-scoped parent Session from the Workspace root, with its \`cwd\` set to the aliased repository.
- \`--repo\` is only a \`cwd\` alias. It does not create a new scope boundary or cross-worktree Parent, Message, or Report semantics. Parent/Child, Message, and Report behavior stay normal same-scope behavior within that repository.
- A repo parent Session should create its own child Sessions inside that repository, the same way a normal Session does.
- To inspect multiple repos at once when a human cockpit is needed, run \`asem tui --scope workspace\`.

## Boundaries

Do not treat asem as a task manager, workflow engine, team coordinator, scheduler, or result judge. Session status is process or connection state only. A Report does not mean completion. A Message is not an event stream or unread queue.

Scope guards:

- Do not invent cross-worktree Parent, Report, or Message semantics. Worktree isolation holds even when Sessions share a Workspace name or a Repo Alias.
- Do not infer task completion from Reports or Session status. asem does not judge whether an Agent finished its assignment.
- Do not turn Agent Profiles into workflow roles. An Agent Profile shapes a Session's initial prompt and launch defaults; it is not a role, position, or workflow step.
`;

export const skillDocument = `${frontmatter}\n\n${body}`;
