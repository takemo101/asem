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
- \`report_parent\`
- \`close_session\`

Fallback CLI commands:

- \`asem session create\`
- \`asem message send\`
- \`asem message wait\`
- \`asem report parent\`
- \`asem session close\`
- \`asem workspace repo list\`

## Normal playbook

1. Create a bounded worker Session.
2. Wait for its Report.
3. For non-trivial work, create a separate reviewer Session.
4. If review blocks, send the worker a Message with repair instructions.
5. Repeat until acceptable.
6. Close child Sessions; do not delete history unless explicitly asked.

## Workspace repo aliases

A Repo Alias is a named cwd shortcut. If the Workspace root \`.asem.yaml\` defines \`repos\`, use:

\`\`\`sh
asem workspace repo list
eval "$(asem init-session --name workspace-root --root --mux herdr)"
asem session create frontend-parent --repo frontend --prompt "Act as the frontend parent Session."
\`\`\`

--repo only chooses the new Session cwd. It does not change parent, Message, or Report semantics. In the example, \`frontend-parent\` is a child of the Workspace current Session and runs with cwd set to the \`frontend\` alias path.

You may pass the parent explicitly:

\`\`\`sh
asem session create frontend-parent --repo frontend --parent <root-session-id> --prompt "Report progress with: asem report parent --body ..."
# from inside the repo parent Session:
asem report parent --body "frontend report"
\`\`\`

With MCP, pass \`repo\` and the same parent id to \`create_session\`, then call \`report_parent\` from that child Session:

\`\`\`ts
create_session({ repo: "frontend", parentSessionId: "<root-session-id>" });
report_parent({ body: "frontend report" });
\`\`\`

Repo parent Sessions create their own repo-local child Sessions. Use \`asem tui --scope workspace\` when a human needs to inspect multiple repos together.

## Boundaries

- Session status is process state, not success/failure.
- Report is communication, not completion.
- Keep Parent/Report/Message semantics inside one Workspace; \`--repo\` is just cwd selection.
- Agent Profiles shape prompts; they are not workflow roles.
- Do not edit .asem runtime files directly, especially \`.asem/sessions/\`, \`.asem/tokens/\`, or \`.asem/current-session*.json\`.
`;

export const skillDocument = `${frontmatter}\n\n${body}`;
