<div align="center">

![Schaltwerk Logo](./ascii_logo.gif)

<img width="1702" height="964" alt="screenshot" src="https://github.com/user-attachments/assets/95e8f5cb-f13e-427c-9257-fc9f13402e5c" />

</div>

# Schaltwerk

Manage multiple AI coding agents in isolated git worktrees. Each agent works in its own branch with dedicated terminals. Everything runs locally—you review, test, and merge when ready.

## Documentation

**[Complete documentation at schaltwerk.mintlify.app](https://schaltwerk.mintlify.app)**

Installation, workflows, agent setup, keyboard shortcuts, MCP integration, troubleshooting, and more.

## What is Schaltwerk?

An orchestration tool for agentic coding. Delegate work to terminal-based AI agents (Claude Code, Codex, Gemini, OpenCode) that write code in isolated git worktrees. Review their work locally, run tests, and merge what works.

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

1. **Write Spec** - Plan your feature/fix in markdown
2. **Start Session** - Creates isolated git worktree + branch
3. **Agent Works** - AI writes code in isolation
4. **You Review** - Real-time diffs, local testing
5. **Mark Ready** - Move to reviewed column
6. **Merge** - Integrate validated changes

## Key Features

- Multiple agents in parallel, each in isolated git worktrees
- Dual terminals per session (agent + your shell)
- Instant session switching with keyboard shortcuts
- Works with any terminal-based AI tool

## Installation

```bash
brew install --cask 2mawi2/tap/schaltwerk
open -a Schaltwerk
```

First launch requires security approval (System Settings → Privacy & Security → Open Anyway).

See [installation docs](https://schaltwerk.mintlify.app/installation) for manual install and troubleshooting.

## Architecture

Built with Tauri (Rust backend + React/TypeScript frontend), git worktrees for isolation, and PTY terminals for native shell emulation.

## For Contributors

### Development

```bash
npm install
npm run tauri:dev
```

### Testing

```bash
npm run test  # Runs TypeScript linting, Rust clippy, tests, and build
```

### Releasing

```bash
just release        # Patch release (0.1.0 -> 0.1.1)
just release minor  # Minor release (0.1.0 -> 0.2.0)
just release major  # Major release (0.1.0 -> 1.0.0)
```

GitHub Actions builds and updates the Homebrew tap automatically.

## License

MIT
