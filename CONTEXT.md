# asem Domain Language

asem is a local agent session manager. It helps humans and agents start, find, attach to, and message agent CLI sessions running inside terminal multiplexers.

## Language

**Session**:
A registered agent CLI process running inside a terminal multiplexer. A Session belongs to one Workspace, has a `cwd`, may have a Parent Session in the same Workspace, and can receive Messages from Sessions in that Workspace.
_Avoid_: Task, job, workflow step, ticket.

**Parent Session**:
The Session that launched or owns another Session. A child Session can report to its direct Parent Session.
_Avoid_: Coordinator, manager, team lead.

**Message**:
A communication from one Session to another Session. A valid, authorized Message is persisted as a durable record before any notification is attempted, and the target Session retrieves it by pulling through the CLI or MCP. Multiplexer pane delivery is best-effort notification only: it never defines whether the Message exists and never proves Agent acceptance.
_Avoid_: Event, task event, notification, command.

**Report**:
A Message from a Session to its Parent Session. Reports are used for progress, findings, questions, or summaries; they do not imply completion.
_Avoid_: Result, completion event, final status.

**Workspace**:
A named logical grouping and safety boundary for related Sessions. Normal Session visibility, parent-child relationships, Messages, and Reports are scoped to one Workspace.
_Avoid_: Project, team, swarm, board.

**Worktree Root**:
The filesystem root for a working copy. A Session stores its Worktree Root as location metadata for launch files, runtime cleanup, grouping, and filters; it is not the normal parent/message/report boundary.
_Avoid_: Workspace boundary, project membership, coordination scope.

**Repo Alias**:
A human convenience name in `.asem.yaml` that resolves to a filesystem directory used as the `cwd` for Session creation. A Repo Alias is only a cwd shortcut; it does not create a scope boundary or special Parent Session, Message, or Report semantics.
_Avoid_: Project membership, package graph, orchestration target.

**Multiplexer**:
The terminal environment that owns the live pane for a Session, such as herdr, tmux, rmux, or zellij.
_Avoid_: Agent runtime, session manager.

**Agent**:
The external AI CLI process launched inside a Session, such as Claude Code, Codex, pi, agy, or opencode.
_Avoid_: Multiplexer, worker, role.

**Integration Target**:
An external AI client or tool whose local configuration can be updated so it knows how to use asem, such as MCP server registration or Skill installation. An Integration Target is not the Agent launched inside a Session.
_Avoid_: Agent when the meaning is configuration target, Session Agent, worker.

**Agent Profile**:
A named bundle of behavior instructions applied to a new Session's initial prompt. An Agent Profile may provide launch defaults such as Agent or model, but it is not a workflow role and does not decide task outcomes.
_Avoid_: Role, position, strategy, workflow step.

**Template**:
A configured command sequence that tells asem how to use a Multiplexer or start an Agent.
_Avoid_: Adapter, plugin, workflow.

**Command Sequence**:
A short ordered set of shell-oriented steps used to create panes, start agents, send text, attach, or close. Command Sequences are startup/control procedures, not workflows.
_Avoid_: Workflow, pipeline, strategy.

**Init Wizard**:
A human CLI setup flow for initializing an asem Workspace and choosing its default Agent, Multiplexer, and Templates. It creates initial configuration; it is not a general configuration editor.
_Avoid_: Config marketplace, template authoring workflow, environment doctor.

**Cockpit**:
The human TUI view for supervising Sessions in a Workspace, with optional worktree/repo filters.
_Avoid_: Dashboard when it implies analytics; orchestrator when it implies control logic.

## Flagged ambiguities

- “Task” is intentionally not used. asem manages live agent Sessions, not units of work with outcomes.
- “Role” is intentionally not part of the MVP. Session specialization should be expressed through Session names, prompts, Agent Profiles, and Agent Templates, not workflow roles.
- “Workspace” does not mean herdr workspace. It is asem's logical grouping term.
- “Inbox” is only a filtered view of Messages addressed to the current Session. It is not a durable unread queue; cursors are opaque caller-held positions, not persisted read state.
- “Delivered” is a notification-transport outcome: the target mux `send` Command Sequence succeeded. It does not mean the Agent or model read, accepted, or acted on the Message.
- “mux: none” is a normal pull-only fallback for externally started Agents, not an error state. New Messages to such a Session are `undelivered` and need no remediation.
- “Report” does not close a Session and does not mean the work is done.
- “Completion” is not a domain state. A Session may exit or be closed, but asem does not judge whether the agent accomplished its assignment.
- “Workspace” does not imply task orchestration. It is the Session tree and communication safety boundary, not a task/workflow/team model.
- “Worktree Root” is location metadata. Do not use it as the normal boundary for Parent Session, Message, or Report behavior.
- “Effective Scope” was the old term for `workspace_id + worktree_root`; use Workspace for the normal boundary instead.
- “Repo Alias” is a cwd convenience for Session creation, not a new scope boundary or cross-repository coordination model.
