<div align="center">

![Schaltwerk Logo](./ascii_logo.gif)

**Native terminal AI agents with git worktree isolation. Spec-driven development for parallel workflows.**

Run GitHub Copilot CLI, Claude Code, Kilo Code, OpenCode, Codex, Pi, Gemini, Qwen, Factory Droid, and Amp natively—no wrappers, no limitations. Or use Terminal Only mode for manual work. Each session gets its own worktree.

[![Test](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml/badge.svg)](https://github.com/2mawi2/schaltwerk/actions/workflows/test.yml)

**[📚 Docs](https://schaltwerk.mintlify.app)** | **[⭐ Star this repo](https://github.com/2mawi2/schaltwerk)**

<img width="1702" height="964" alt="screenshot" src="https://github.com/user-attachments/assets/95e8f5cb-f13e-427c-9257-fc9f13402e5c" />

</div>

## Why Schaltwerk?

**Native Terminal Integration** - Schaltwerk runs agentic coding CLIs directly—no wrappers, no abstractions. You get the latest versions with all their features, exactly as you'd use them in your terminal. The difference is you can run multiple sessions simultaneously.

**Efficient Multi-Agent Coordination** - When running multiple agents, switching between them efficiently matters. Schaltwerk provides instant session switching (⌘1-9), always-visible specs, and clear activity overviews so you know what each agent is doing.

**Advanced Agent Orchestration** - Schaltwerk includes an MCP server, allowing one terminal agent to orchestrate multiple others. An orchestrator agent can control everything you can—creating sessions, managing workflows, and coordinating parallel agents.

**Spec-Driven Development** - Write specs in markdown, start sessions from them, and re-implement when needed. Specs become your reusable backlog. If an agent goes off-track, dismiss the worktree and restart with a refined spec—no cleanup needed.

**Full Control & Privacy** - GitHub-style diff reviews with inline comments you can paste back to the agent. Simultaneous spec view, diff view, and terminal output. Manual testing in the bottom terminal anytime. Schaltwerk doesn't track or trace your data—use public APIs or configure agents to run against your private endpoints (Azure, self-hosted, etc.).

## Requirements

- **macOS 11+** (Big Sur or later)
- **Windows 10/11** (native; WSL not yet supported)
- **Linux** - beta builds available via releases
- **Git 2.30+**
- At least one agentic coding CLI: GitHub Copilot CLI, Claude Code, OpenCode, Codex, Pi, Gemini, Qwen, Factory Droid, or Amp (or use Terminal Only mode for manual work)

## Quick Start (60 seconds)

1. Install and launch Schaltwerk:
   ```bash
   brew install --cask 2mawi2/tap/schaltwerk && open -a Schaltwerk
   ```
2. Open your project: drag the repo in or use `File → Open Project…`.
3. Start an agent (`⌘N`): choose GitHub Copilot, Claude Code, OpenCode, Qwen, Amp, or another AI and give it a task prompt.
4. Let the agent work—Schaltwerk spins up its own branch/worktree; use the second terminal to run tests or manual checks while it codes.
5. Review diffs, leave comments, mark reviewed with `⌘R`, then in Reviewed hit **Merge/PR** or `⌘⇧M` to squash-merge back to your branch.

Your agents now deliver isolated branches on autopilot—keep switching with `⌘1-9`, rinse, and repeat.

> Treat specs like a reusable backlog. Spin them up as sessions when you're ready, and if an experiment misses the mark, use `⌘S` to discard the worktree, keep the spec, and relaunch later with fresh prompts.

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

**Session Management**
- Create sessions from specs or start directly with `⌘N`
- Switch between sessions instantly with `⌘1-9`
- Mark sessions reviewed with `⌘R` when ready
- Merge or create PRs with `⌘⇧M`
- Dismiss worktrees with `⌘S` while keeping specs

**UI Components**
- Spec panel - View and edit session specs
- Diff panel - GitHub-style code review with inline comments
- Dual terminals - Agent terminal + your testing shell per session
- Session overview - See all agents (running, idle, reviewed)
- Activity indicators - Real-time status for each session

**Git Integration**
- Automatic worktree creation per session
- Isolated branches (no conflicts between agents)
- Squash-merge to main with one command
- Direct PR creation via GitHub CLI integration
- Session resumption support (Claude Code, Codex, Pi, and other supported agents)

**Agent Configuration**
- Custom environment variables per agent
- Configure arguments for each CLI
- Run against private APIs (Azure, self-hosted)
- No data tracking from Schaltwerk
- MCP server for orchestrator agents
- Terminal Only mode for manual work without AI agents

## Installation

See [Quick Start](#quick-start-60-seconds) for the basic Homebrew installation (macOS).

### Windows

Download the latest Windows installer (`.exe` or `.msi`) from [GitHub Releases](https://github.com/2mawi2/schaltwerk/releases) and run it. WSL is not yet supported—use native Windows Git and terminals.

### Linux

Download the `.deb` or `.AppImage` from [GitHub Releases](https://github.com/2mawi2/schaltwerk/releases).

### macOS First Launch

Security approval required: System Settings → Privacy & Security → Open Anyway

### Updating from 0.2.2 or earlier (macOS)

The Homebrew cask now cleans up old installs automatically. If you're on 0.2.2 or an older build that refuses to upgrade, do a one-time cleanup and reinstall:

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

Install dependencies with `bun install` (or `npm install` if you prefer), then choose the workflow that suits you best. The [`Justfile`](./Justfile) lists optional recipes if you prefer using [`just`](https://github.com/casey/just); each recipe maps to standard package-manager/cargo commands you can run directly.

```bash
# Optional helpers via just (install with brew install just)
bun install          # or: npm install
just test            # Run full validation suite before commits
just run             # Start dev app with hot reload
just release         # Create new release (patch/minor/major)
```

```bash
# Or stick with plain package-manager/cargo commands
bun run test         # or: npm run test
bun run tauri:dev    # or: npm run tauri:dev
bun run tauri:build  # or: npm run tauri:build
```

GitHub Actions builds and updates the Homebrew tap automatically.

## License

MIT
