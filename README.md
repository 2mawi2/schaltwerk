<div align="center">

![Schaltwerk Logo](./ascii_logo.gif)

**Run multiple AI coding agents in parallel, each in their own git worktree. Test locally, merge what works.**

<img width="1702" height="964" alt="screenshot" src="https://github.com/user-attachments/assets/95e8f5cb-f13e-427c-9257-fc9f13402e5c" />

</div>

# Schaltwerk

[![Test](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml/badge.svg)](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml)

## Quick Start (60 seconds)

1. Install and launch Schaltwerk:
   ```bash
   brew install --cask 2mawi2/tap/schaltwerk && open -a Schaltwerk
   ```
2. Open your project: drag the repo in or use `File → Open Project…`.
3. Start an agent with `⌘N` (or **Start Agent**), pick the base branch + terminal AI (e.g., Claude Code), and optionally seed it with the Dark Mode prompt.
4. Let the agent work—Schaltwerk spins up its own branch/worktree; use the second terminal to run tests or manual checks while it codes.
5. Review diffs, leave comments, mark reviewed with `⌘R`, then in Reviewed hit **Merge/PR** or `⌘⇧M` to squash-merge back to your branch.

Your agents now deliver isolated branches on autopilot—keep switching with `⌘1-9`, rinse, and repeat.

> Treat specs like a reusable backlog. Spin them up as sessions when you're ready, and if an experiment misses the mark, use `⌘S` to discard the worktree, keep the spec, and relaunch later with fresh prompts.

**[📚 Full documentation](https://schaltwerk.mintlify.app)** | **[⭐ Star this repo](https://github.com/2mawi2/schaltwerk)** if it helped you!

Looking for multi-agent orchestration patterns? Check out the **Scaffold → Swarm → Stabilize** and **Continuous Maintenance** playbooks in the [advanced workflows guide](https://schaltwerk.mintlify.app/guides/advanced-workflows).

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

### Development

Install dependencies with `npm install`, then choose the workflow that suits you best. The [`Justfile`](./Justfile) lists optional recipes if you prefer using `just`; each recipe maps to standard npm/cargo commands you can run directly.

```bash
# Optional helpers via just (install with brew install just)
npm install
just test            # Run full validation suite before commits
just run             # Start dev app with hot reload
just release         # Create new release (patch/minor/major)
```

```bash
# Or stick with plain npm/cargo commands
npm run test         # Lint, clippy, tests, build
npm run tauri:dev    # Start dev app with hot reload
npm run tauri:build  # Production build
```

GitHub Actions builds and updates the Homebrew tap automatically.

## License

MIT
