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

## Boundaries

Do not treat asem as a task manager, workflow engine, team coordinator, scheduler, or result judge. Session status is process or connection state only. A Report does not mean completion. A Message is not an event stream or unread queue.

Do not edit token-bearing or generated runtime state under \`.asem/sessions/\`, \`.asem/tokens/\`, or \`.asem/current-session*.json\` directly.
`;

export const skillDocument = `${frontmatter}\n\n${body}`;
