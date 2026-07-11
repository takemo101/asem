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

Use asem to run and coordinate local AI CLI Sessions in terminal multiplexers. It records durable Messages and Reports, but it does not judge whether work succeeded.

## When to use

Use asem when work benefits from:

- a separate agent Session;
- durable Messages/Reports;
- independent review;
- Workspace Session tree supervision across repo cwd values.

Do not use asem as a task manager or workflow engine.

## Use MCP first

Prefer MCP tools when available:

- \`create_session\`
- \`send_message\`
- \`list_messages\`
- \`wait_messages\`
- \`peek_session\`
- \`report_parent\`
- \`close_session\`

Fallback CLI commands:

- \`asem session create\`
- \`asem message send\`
- \`asem message list\`
- \`asem message wait\`
- \`asem session peek\`
- \`asem report parent\`
- \`asem session close\`
- \`asem workspace repo list\`

## Message protocol

Messages are durable and pull-only; pane delivery is best-effort notification.

1. On ordinary startup, drain your Inbox oldest-first: \`list_messages({ filter: { inbox: true } })\`, then follow \`nextCursor\` while \`hasMore\` is true.
2. Retain the final \`nextCursor\`; it is your Inbox position for later list/wait calls.
3. Wait (\`wait_messages({ cursor })\` / \`asem message wait --cursor <cursor>\`) only when the human prompt or your Agent Profile says to wait. A timeout is success — an empty page with \`timedOut: true\`; keep its cursor and decide again.
4. Use \`cursor: "latest"\` only for an explicit, intentional tail start; it skips history.
5. \`delivery.status: "failed"\` is notification failure only; the Message is stored. Never resend automatically.

Public results carry only \`id\`, \`fromSessionId\`, \`toSessionId\`, \`kind\`, \`body\`, \`createdAt\`, \`delivery\`. Bodies cap at 64 KiB; pages default to 20 and cap at 50. Cursors are opaque, query-bound, and never grant access.

## Workspace repo aliases

A Repo Alias is a named cwd shortcut. If the Workspace root \`.asem.yaml\` defines \`repos\`, list aliases first:

\`\`\`sh
asem workspace repo list
\`\`\`

Create repo parent Sessions from a Workspace root/current Session:

\`\`\`sh
# If this process is not already an asem Session, register it with a real mux ref.
asem init-session --name workspace-root --root --mux herdr --mux-ref '<json>'

asem session create frontend-parent --repo frontend --parent <root-session-id> --prompt "Report progress with: asem report parent --body ..."
asem session create backend-parent --repo backend --parent <root-session-id> --prompt "Report progress with: asem report parent --body ..."
\`\`\`

\`--repo\` only chooses the new Session cwd/worktreeRoot. Parent, Message, and Report lookup stay inside the same Workspace, so repo parent Sessions can report to a root parent Session across repo worktree roots.

From inside each repo parent Session:

\`\`\`sh
asem report parent --body "frontend report"
\`\`\`

With MCP, pass \`repo\` and the same parent id to \`create_session\`, then call \`report_parent\` from that child Session:

\`\`\`ts
create_session({ repo: "frontend", parentSessionId: "<root-session-id>" });
report_parent({ body: "frontend report" });
\`\`\`

Repo parent Sessions create their own repo-local child Sessions. Use \`asem tui --scope workspace\` when a human needs to inspect multiple repos together.

## Live pane snapshots

Use \`peek_session\` (or \`asem session peek <id>\`) to inspect a Session's live terminal output without attaching. Peek output is not durable Message history and is returned without redaction, so use it only inside the Workspace trust boundary.

## Boundaries

- Session status is process state, not success/failure.
- Report is communication, not completion.
- Keep Parent/Report/Message semantics inside one Workspace; \`--repo\` is just cwd selection.
- Agent Profiles shape prompts; they are not workflow roles.
- Close child Sessions when done; do not delete history unless explicitly asked.
- Do not edit .asem runtime files directly, especially \`.asem/sessions/\`, \`.asem/tokens/\`, or \`.asem/current-session*.json\`.
`;

export const skillDocument = `${frontmatter}\n\n${body}`;
