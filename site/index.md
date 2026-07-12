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
    title: Root and child Sessions
    details: "Launch the human root Session with asem run, then create child Sessions from it. Sessions, Messages, Reports, and parent links are scoped to the Workspace, with Worktree Roots as location metadata and filters."
  - icon: 💬
    title: Messages and Reports
    details: Send durable local Messages to child Sessions and collect Reports back from them. Pane delivery is best-effort notification; the stored Message is the durable truth.
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
