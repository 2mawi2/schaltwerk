# Schaltwerk Documentation

Schaltwerk keeps every AI coding session in its own git worktree so you can run multiple agents safely on the same repository. These guides cover the basics of installing the app, understanding the core concepts, and driving day-to-day sessions.

## Quick Navigation
- [Getting Started](./getting-started.md) – install the app and launch your first session
- [Core Concepts](./core-concepts.md) – learn how sessions, specs, and the orchestrator fit together
- [Using Schaltwerk](./using-schaltwerk.md) – daily workflow for creating, running, and reviewing sessions
- [Agent Setup](./agent-setup.md) – configure binaries, environment variables, setup scripts, and run mode
- [MCP Integration](./mcp-integration.md) – connect external tools through the REST API
- [Keyboard Shortcuts](./keyboard-shortcuts.md) – full list of built-in shortcuts

## What You Need to Know Up Front
- Schaltwerk runs on macOS and ships as a Tauri desktop application
- Each session is an isolated git worktree managed by the app
- Specs are markdown planning documents that can be promoted to full sessions
- The orchestrator is a special session that stays on your main branch for planning and coordination
- Two PTY terminals are created per session so agents can run alongside your own commands
