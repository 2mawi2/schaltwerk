<div align="center">

![Schaltwerk Logo](./ascii_logo.gif)

</div>

# Schaltwerk: The IDE Without an Editor

Schaltwerk manages multiple AI coding agents in isolated git worktrees. Everything runs locally on your machine. You test and review changes locally before they hit your main branch.

## What is Schaltwerk?

It's an orchestration tool for agentic coding. In this IDE you do not edit code yourself, you delegate specs to terminal-based AI agents (like Claude Code and Codex) that write the code for you. Each agent works in its own git worktree, completely isolated from your main codebase. You review their work locally, run tests, and merge what works.

## Why Schaltwerk?

**Parallel development** - Run multiple AI agents at the same time on different features. Each gets its own git worktree, so they can't interfere with each other.

**Fast context switching** - Switch between sessions with keyboard shortcuts (⌘1-9). The terminals stay running in the background, so switching is instant.

**Local testing** - Everything happens on your machine. Run your test suite, build the project, debug issues - all before any code gets committed.

**Works with any AI** - Claude, Codex, Gemini, OpenCode, your own scripts - if it runs in a terminal, Schaltwerk can manage it.

**Spec-driven workflow** - Start by writing what you want in markdown. Convert it to a session when ready. The spec becomes the agent's initial prompt.

## Core Features

### Multi-Agent Support
- Run different AI agents (Claude, Codex, Gemini, OpenCode)
- Each agent works in its own git worktree
- Manage multiple agents working on different parts of your codebase

### Keyboard Navigation
- **⌘1-9**: Jump directly to any session
- **⌘↑/↓**: Move through sessions
- **⌘←/→**: Switch between Specs, Running, and Reviewed views
- Background terminals mean no waiting when you switch

### Review Workflow
- **Interactive diffs**: Review changes like on GitHub - add comments and send feedback directly back to the agent
- **Git branches**: Every session is a real git branch
- **Local testing**: Run your test suite before merging

### Built for Developers
- **Two terminals per session**: One for the agent, one for running commands
- **Session persistence**: Terminals stay alive in the background - switch away and come back anytime without losing context
- **File watching**: Changes appear immediately in the diff view
- **Keyboard shortcuts**: Everything important has a shortcut

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    SPEC     │ --> │   RUNNING   │ --> │  REVIEWED   │
│  (Planning) │     │  (Working)  │     │   (Ready)   │
└─────────────┘     └─────────────┘     └─────────────┘
      ↓                    ↓                    ↓
   Markdown          Git Worktree          Ready to Merge
   Document          + Agent + Terminal     to Main Branch
```

1. **Write Spec** → Plan your feature/fix in markdown
2. **Start Session** → Creates isolated git worktree + branch
3. **Agent Works** → AI writes code in isolation
4. **You Review** → Real-time diffs, local testing
5. **Mark Ready** → Move to reviewed column
6. **Merge** → Integrate validated changes

## The Orchestrator: Your Command Center

The orchestrator is a special terminal that runs in your main repository (not in a worktree). Think of it as your project manager that can:

### What the Orchestrator Does

- **Plan and create specs** - Write multiple specs for complex features
- **Launch agents in parallel** - Start multiple sessions from specs simultaneously  
- **Review agent work** - Check diffs, run tests, provide feedback
- **Integrate changes** - Merge approved sessions back to main branch or create PRs
- **Coordinate workflows** - Chain tasks together (plan → execute → review → merge)

### Automated Workflows via MCP

The orchestrator supports MCP (Model Context Protocol), allowing it to:
- Create and manage sessions programmatically
- Start multiple agents working on different specs
- Monitor progress and collect results
- Orchestrate complex multi-agent workflows

For example, the orchestrator can:
1. Break down a large feature into multiple specs
2. Launch different agents on each spec in parallel
3. Wait for completion and review the results
4. Integrate the changes that pass review
5. Create a pull request with all approved changes

### Customization Options

Schaltwerk is designed to adapt to your workflow:

- **Claude slash commands** - Create custom commands that execute orchestrator actions
- **Action buttons** - Configure F1-F6 with prompts for common workflows
- **Prompt templates** - Save and reuse complex orchestration patterns
- **MCP integration** - Connect external tools to automate session management

This means you can build workflows like:
- "Break this feature into 3 parts and assign to different agents"
- "Review all completed sessions and merge the passing ones"
- "Create specs from these GitHub issues and start agents on each"

The orchestrator turns Schaltwerk from a session manager into a complete development automation platform.

## Installation

### Via Homebrew

```bash
# Install
brew install --cask 2mawi2/tap/schaltwerk

# Launch
open -a Schaltwerk
```

First launch requires security approval (right-click → Open).

## Quick Start

### Development

```bash
npm install
npm run tauri:dev
# Pass args to the app like this (first -- is for npm, the other two for Tauri)
npm run tauri:dev -- -- -- --help
```

### MCP Server Setup (for Claude Code integration)

```bash
just mcp-setup
```

### Building

```bash
npm run build
npm run tauri build
```

### Testing

```bash
npm run test
```

## Key Keyboard Shortcuts

Master these for maximum productivity:

- **⌘1-9** - Instant switch to sessions 1-8 (⌘1 for orchestrator)
- **⌘N** - Create new agent session
- **⌘Shift+N** - Create new spec (planning doc)
- **⌘R** - Mark session as reviewed
- **⌘S** - Convert session to spec
- **⌘↑/↓** - Navigate between sessions
- **⌘T** - Focus agent terminal
- **⌘/** - Focus shell terminal

See [full keyboard shortcuts](./docs/keyboard-shortcuts.md) for complete reference.

## What Makes Schaltwerk Different?

### vs. Cloud AI Platforms (Claude.ai, ChatGPT)
- **Local execution** - Your code stays on your machine
- **Test before commit** - Run your actual test suite and build
- **Multiple agents** - Use different AI tools for different tasks
- **Real git branches** - Not just chat history exports

### vs. IDE Plugins (Copilot, Cursor IDE, Continue)
- **Multiple agents in parallel** - Not just one AI assistant
- **Complete isolation** - Agents work in separate worktrees
- **Review-focused** - Built specifically for reviewing AI output

### vs. Terminal Multiplexers (tmux, screen)
- **Agent session management** - Not just generic terminals
- **Automatic git worktrees** - No manual branch setup
- **Visual session tracking** - Lifecycle views for specs, running sessions, and reviews

## Architecture

Schaltwerk combines three key technologies:

- **Tauri**: Native desktop app with web UI (React/TypeScript frontend, Rust backend)
- **Git Worktrees**: Complete isolation for each AI session
- **PTY Terminals**: Native terminal emulation for any command-line tool

## Releasing New Versions

```bash
just release        # Patch release (0.1.0 -> 0.1.1)
just release minor  # Minor release (0.1.0 -> 0.2.0)
just release major  # Major release (0.1.0 -> 1.0.0)
just release 1.2.3  # Specific version
```

GitHub Actions automatically builds and updates Homebrew tap.
Users update via: `brew upgrade --cask schaltwerk`

## Use Cases

### Parallel Feature Development
Have Claude work on the authentication system while OpenCode builds the UI. Each works in isolation. Review both, merge what works.

### Multiple Bug Fixes
Assign different bugs to different agents. Each fix gets tested in its own worktree before you merge it.

### Safe Refactoring
Let an agent refactor code in an isolated branch. Run your full test suite, check performance, review every change.

### Comparing Implementations
Have two agents solve the same problem differently. Test both solutions, pick the better one.


## License

MIT
