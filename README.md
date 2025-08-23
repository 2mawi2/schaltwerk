# Schaltwerk

Schaltwerk is a Tauri-based desktop application that provides a visual interface for managing Schaltwerk sessions. It features multiple terminal panels, session management, and real-time status monitoring.

## Features

- **Multi-terminal Interface**: Dual-pane terminal layout with Claude integration
- **Session Management**: Create, switch between, and manage Schaltwerk sessions
- **Real-time Monitoring**: Live session status and progress tracking
- **Diff Viewer**: Integrated diff viewing with review capabilities
- **Keyboard Navigation**: Comprehensive keyboard shortcuts for efficient workflow

## Installation

### Via Homebrew (Internal Users)

```bash
# One-time setup
brew tap 2mawi2/tap https://github.com/2mawi2/homebrew-tap

# Install
brew install --cask schaltwerk

# Launch
open -a Schaltwerk
```

First launch requires security approval (right-click → Open).

## Quick Start

### Development

```bash
npm install
npm run tauri dev
# Pass args to the app like this (first -- is for npm, the other two for Tauri)
npm run tauri dev -- -- -- --help
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

## Documentation

### [📋 Keyboard Shortcuts](./docs/keyboard-shortcuts.md)

Complete reference for all keyboard shortcuts and navigation:

- **⌘T** / **Ctrl+T** - Focus sessions
- **⌘/** / **Ctrl+/** - Focus terminal
- **⌘1-9** - Switch sessions
- **⌘N** - New session
- And many more...

See the [full documentation](./docs/) for detailed guides and references.

## Architecture

### Frontend (React/TypeScript)

- `src/components/` - React components
- `src/hooks/` - Custom React hooks
- `src/contexts/` - React Context providers

### Backend (Rust/Tauri)

- `src-tauri/src/` - Rust application logic
- Terminal PTY management
- Process lifecycle handling

## Releasing New Versions

```bash
just release        # Patch release (0.1.0 -> 0.1.1)
just release minor  # Minor release (0.1.0 -> 0.2.0)
just release major  # Major release (0.1.0 -> 1.0.0)
just release 1.2.3  # Specific version
```

GitHub Actions automatically builds and updates Homebrew tap.
Users update via: `brew upgrade --cask schaltwerk`

## Development Setup

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
