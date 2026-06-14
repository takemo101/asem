---
layout: home

hero:
  name: asem
  text: Local agent Session manager
  tagline: Create child Sessions, exchange Messages, collect Reports, and inspect local agent work without turning your project into a workflow engine.
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart
    - theme: alt
      text: Install
      link: /install
    - theme: alt
      text: View on GitHub
      link: https://github.com/takemo101/asem

features:
  - icon: 🧭
    title: Scoped local Sessions
    details: "Sessions are visible in the Effective Scope: Workspace plus Worktree Root. Local state stays tied to the project you are working in."
  - icon: 💬
    title: Messages and Reports
    details: Send durable Messages to child Sessions and collect Reports back from them. Pane delivery is best-effort; local store rows are the durable truth.
  - icon: 🖥️
    title: Multiplexer-backed launch
    details: Launch or attach through Templates for tmux, zellij, herdr, rmux, or other local multiplexers without hard-coding one terminal model.
  - icon: 🧑‍💻
    title: Agent Profiles
    details: Shape prompts with explicit Profiles such as reviewer, worker, planner, debugger, and researcher. Profiles do not create roles or workflow state.
  - icon: 🔌
    title: Stdio MCP for agents
    details: Expose primitive Session and Message operations through a stdio MCP server for compatible AI clients.
  - icon: 🧩
    title: Integration Target setup
    details: Register MCP and install Skill guidance for supported AI clients through CLI-only setup commands.
---
