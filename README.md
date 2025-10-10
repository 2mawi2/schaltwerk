<div align="center">

![Schaltwerk Logo](./ascii_logo.gif)

**Run multiple AI coding agents in parallel, each in their own git worktree. Test locally, merge what works.**

<img width="1702" height="964" alt="screenshot" src="https://github.com/user-attachments/assets/95e8f5cb-f13e-427c-9257-fc9f13402e5c" />

</div>

# Schaltwerk

[![Test](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml/badge.svg)](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml)

## Quick Start (60 seconds)

```bash
# Install and open Schaltwerk
brew install --cask 2mawi2/tap/schaltwerk && open -a Schaltwerk

# In your git repo, create a session for your AI agent (e.g., Claude Code)
# Click "New Session" → Name it "fix-auth-bug" → Select agent → Start working
```

That's it! Your AI agent is now coding in an isolated branch. Switch between sessions with `⌘1-9`, review changes in real-time, merge when ready.

**[📚 Full documentation](https://schaltwerk.mintlify.app)** | **[⭐ Star this repo](https://github.com/2mawi2/schaltwerk)** if it helped you!

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    SPEC     │ --> │   RUNNING   │ --> │  REVIEWED   │
│  (Planning) │     │  (Working)  │     │   (Ready)   │
└─────────────┘     └─────────────┘     └─────────────┘
     ↓                    ↓                    ↓
  Markdown          Git Worktree          Ready to Merge/PR
  Document          + Agent + Terminal     to Main Branch
```

1. **Write Spec** - Plan your feature/fix in markdown
2. **Start Session** - Creates isolated git worktree + branch
3. **Agent Works** - AI writes code in isolation
4. **You Review** - Real-time diffs, local testing, write review comments like on GitHub on the changes
5. **Mark Ready** - Move to reviewed column
6. **Merge/PR** - Integrate validated changes

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

### Updating from 0.2.2 or earlier

The Homebrew cask now cleans up old installs automatically. If you’re on 0.2.2 or an older build that refuses to upgrade, do a one-time cleanup and reinstall:

```bash
brew uninstall --cask --force schaltwerk
rm -rf /opt/homebrew/Caskroom/schaltwerk/0.2.0/Schaltwerk.app
brew install --cask 2mawi2/tap/schaltwerk
```

After this reset, future `brew upgrade --cask schaltwerk` runs will succeed without manual steps.

See [installation docs](https://schaltwerk.mintlify.app/installation) for manual install and troubleshooting.

## Architecture

Built with Tauri (Rust backend + React/TypeScript frontend), git worktrees for isolation, and PTY terminals for native shell emulation.

## Contributing

We actively welcome contributions—whether that's reporting issues, improving docs, or shipping code. Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for ways to get involved and the project's quality checklist.

**⭐ If Schaltwerk helped you ship faster, [please star the repo](https://github.com/2mawi2/schaltwerk)!**

### Development

Requires [just](https://github.com/casey/just#installation) (`brew install just`).

```bash
npm install
just test            # Run full validation suite before commits
just run             # Start dev app with hot reload
just release         # Create new release (patch/minor/major)
```

GitHub Actions builds and updates the Homebrew tap automatically.

## License

MIT
