# asem Domain Language

asem is a local agent session manager. It helps humans and agents start, find, attach to, and message agent CLI sessions running inside terminal multiplexers.

## Language

**Session**:
A registered agent CLI process running inside a terminal multiplexer. A Session can receive Messages from other Sessions in the same effective scope and may have a parent Session.
_Avoid_: Task, job, workflow step, ticket.

**Parent Session**:
The Session that launched or owns another Session. A child Session can report to its direct Parent Session.
_Avoid_: Coordinator, manager, team lead.

**Message**:
A communication from one Session to another Session. Messages are recorded for history and may also be delivered to the target Session's multiplexer pane.
_Avoid_: Event, task event, notification, command.

**Report**:
A Message from a Session to its Parent Session. Reports are used for progress, findings, questions, or summaries; they do not imply completion.
_Avoid_: Result, completion event, final status.

**Workspace**:
A named logical grouping for related work. A Workspace name alone does not override worktree isolation.
_Avoid_: Project, team, swarm, board.

**Worktree Root**:
The filesystem root that isolates a working copy. Normal Session visibility and messaging are scoped by Workspace plus Worktree Root.
_Avoid_: Directory, project root, repository when the isolation boundary specifically means the active worktree.

**Effective Scope**:
The boundary inside which Sessions can normally see and message each other: Workspace plus Worktree Root.
_Avoid_: Global workspace, project scope when worktree isolation matters.

**Multiplexer**:
The terminal environment that owns the live pane for a Session, such as herdr, tmux, or zellij.
_Avoid_: Agent runtime, session manager.

**Agent**:
The external AI CLI process launched inside a Session, such as Claude Code, Codex, pi, agy, or opencode.
_Avoid_: Multiplexer, worker, role.

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
The human TUI view for supervising Sessions in a scope.
_Avoid_: Dashboard when it implies analytics; orchestrator when it implies control logic.

## Flagged ambiguities

- “Task” is intentionally not used. asem manages live agent Sessions, not units of work with outcomes.
- “Role” is intentionally not part of the MVP. Session specialization should be expressed through Session names, prompts, and agent templates, not workflow roles.
- “Workspace” does not mean herdr workspace. It is asem's logical grouping term.
- “Inbox” is only a filtered view of Messages addressed to the current Session. It is not a durable unread queue.
- “Report” does not close a Session and does not mean the work is done.
- “Completion” is not a domain state. A Session may exit or be closed, but asem does not judge whether the agent accomplished its assignment.
- “Worktree isolation” is part of the domain. Separate worktrees must not normally message each other just because they share a Workspace name.
