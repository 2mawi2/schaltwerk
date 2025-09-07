# CLAUDE.md - Schaltwerk Development Guidelines

## Project Overview
Tauri-based desktop app for managing AI coding sessions using git worktrees. Each session gets an isolated branch/worktree where AI agents (Claude, Cursor, etc.) can work without affecting the main codebase.

## System Architecture

### Core Concepts
- **Sessions**: Isolated git worktrees for AI agents to work in
- **Specs**: Draft/planning sessions without worktrees (can be converted to running sessions)
- **Orchestrator**: Special session that works directly in main repo (for planning/coordination)
- **Terminals**: Each session gets 2 PTY terminals (top/bottom) for running agents
- **Domains**: Business logic is organized in `src-tauri/src/domains/` - all new features should create appropriate domain modules, if there are legacy business domains duplicated they should be merged via scout rule into the new structure.

### Key Data Flows

**Session Creation → Agent Startup:**
1. `App.tsx:handleCreateSession()` → Tauri command `schaltwerk_core_create_session`
2. `session_core.rs:SessionManager::create_session()` → Creates DB entry + git worktree
3. Frontend switches via `SelectionContext` → Lazy terminal creation
4. Agent starts in terminal with worktree as working directory

**MCP API → Session Management:**
- External tools call REST API (port 8547+hash) → Creates/updates specs
- Backend emits `SessionsRefreshed` event → UI updates automatically
- Optional `Selection` event → UI switches to new session

**Session State Transitions (Kanban):**
- Spec → Running: `start_spec_session()` creates worktree + terminals
- Running → Reviewed: `mark_session_reviewed()` flags for merge
- Running → Spec: `convert_to_spec()` removes worktree, keeps content

### Critical Files to Know

**Frontend Entry Points:**
- `App.tsx`: Main orchestration, session management, agent startup
- `SelectionContext.tsx`: Controls which session/terminals are active
- `KanbanView.tsx`: Visual session lifecycle management

**Backend Core:**
- `main.rs`: Tauri commands entry point
- `session_core.rs`: Session CRUD operations + state management
- `terminal/manager.rs`: PTY lifecycle management
- `git/worktrees.rs`: Git worktree operations

**Communication Layer:**
- `eventSystem.ts`: Type-safe frontend event handling
- `events.rs`: Backend event emission
- `mcp_api.rs`: REST API for external MCP clients

## Essential Commands

### Before Completing ANY Task
```bash
just test          # Run ALL validations: TypeScript, Rust lints, tests, and build
# Or: npm run test  # Same as 'just test'
```
**Why:** Ensures code quality and prevents broken commits. This command runs:
- TypeScript linting (`npm run lint`)
- Rust clippy checks (`cargo clippy`)
- Rust tests (`cargo test`)
- Rust build verification (`cargo build`)

### Development Commands
```bash
# Starting Development
npm run tauri:dev       # Start app in development mode with hot reload
RUST_LOG=schaltwerk=debug npm run tauri:dev  # With debug logging

# Testing & Validation
just test               # Full validation suite (ALWAYS run before commits)
npm run lint            # TypeScript linting only
npm run lint:rust       # Rust linting only (cargo clippy)
npm run test:rust       # Rust tests only

# Running the App
just run                # Start app (ONLY when user requests testing)
npm run tauri:build     # Build production app

# Release Management
just release            # Create patch release (0.0.x)
just release minor      # Create minor release (0.x.0)
just release major      # Create major release (x.0.0)
```

### Command Context
- **Development:** Use `npm run tauri:dev` for active development with hot reload
- **Testing:** Always run `just test` before considering any task complete
- **Debugging:** Set `RUST_LOG` environment variable for detailed logging
- **Production:** Use `npm run tauri:build` to create distributable app

## How Things Actually Work

### Session Storage
Sessions are stored in SQLite at `~/Library/Application Support/schaltwerk/{project-name}/database.db`. Each session tracks:
- Git branch + worktree path (`.schaltwerk/worktrees/{session-name}/`)
- Session state (Spec/Running/Reviewed)
- Spec content (markdown planning docs)
- Git stats (files changed, lines added/removed)

### Terminal Management
- **Creation**: Lazy - only when session is selected in UI
- **Persistence**: Terminals stay alive until explicitly closed
- **PTY Backend**: `LocalPtyAdapter` spawns shell with session's worktree as working directory
- Each session gets 2 terminals (top/bottom) with the worktree as working directory

### Agent Integration
Agents start via terminal commands built in `App.tsx`:
- Cursor: `cursor --folder-uri {worktree-path}`
- Each agent runs in session's isolated worktree

### MCP Server Webhook
- Runs on project-specific port (8547 + project hash)
- Receives notifications from external MCP clients
- Updates session states and emits UI refresh events


## UI Systems

### Color Theme (MANDATORY)
**NEVER use hardcoded colors.** Always use theme system:
- Import: `import { theme } from '../common/theme'`
- TypeScript: `theme.colors.background.secondary`
- CSS: `var(--color-bg-secondary)`
- Tailwind: `bg-primary text-primary`

Categories: background, text, border, accent (blue/green/amber/red/violet/purple/yellow/cyan), status

Common mappings:
- `bg-slate-950` → `theme.colors.background.primary`
- `bg-slate-800` → `theme.colors.background.elevated`
- `text-slate-100` → `theme.colors.text.primary`
- `border-slate-700` → `theme.colors.border.subtle`

### Loading States (MANDATORY)
**NEVER use static text or spinner libraries.** Always use AnimatedText:
```typescript
import { AnimatedText } from '../common/AnimatedText'
<AnimatedText text="loading" size="md" />
```

Predefined states: loading, starting, waiting, initializing, connecting, saving, deleting, creating, converting, marking

Sizes: xs (12-14px), sm (16-18px), md (20-24px), lg (28-32px), xl (36-40px)

### Font Sizes (MANDATORY)
**NEVER use hardcoded font sizes.** Use theme system:
- Semantic: caption, body, bodyLarge, heading, headingLarge, headingXLarge, display
- UI-specific: button, input, label, code, terminal
- Import: `theme.fontSize.body` or `var(--font-body)`

## Testing Requirements

### TDD (MANDATORY)
Always write tests first, before implementing features:
1. **Red**: Write a failing test that describes the desired behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Improve the implementation while keeping tests green

This applies to both TypeScript and Rust code. The test defines the contract before the implementation exists.

### Before ANY Commit
Run `npm run test` - ALL must pass:
- TypeScript linting
- Rust clippy
- Rust tests
- Rust build

**CRITICAL Rules:**
- Test failures are NEVER unrelated - fix immediately
- NEVER skip tests (no `.skip()`, `xit()`)
- Fix performance test failures (they indicate real issues)

## Event System

### Type-Safe Events (MANDATORY)
**NEVER use string literals for events.**

Frontend:
```typescript
import { listenEvent, SchaltEvent, listenTerminalOutput } from '../common/eventSystem'
await listenEvent(SchaltEvent.SessionsRefreshed, handler)
await listenTerminalOutput(terminalId, handler)
```

Backend:
```rust
use crate::events::{emit_event, SchaltEvent};
emit_event(&app, SchaltEvent::SessionsRefreshed, &sessions)?;
```

## Critical Implementation Rules

### Session Lifecycle
- NEVER cancel sessions automatically
- NEVER cancel on project close/switch/restart
- ALWAYS require explicit confirmation for bulk operations
- ALWAYS log cancellations with context

### Terminal Lifecycle
1. Creation: PTY spawned on first access
2. Switching: Frontend switches IDs, backend persists
3. Cleanup: All processes killed on exit

### Code Quality

**Dead Code Policy (CRITICAL)**
- `#![deny(dead_code)]` in main.rs must NEVER be removed
- NEVER use `#[allow(dead_code)]`
- Either use the code or delete it

**Non-Deterministic Solutions PROHIBITED**
- NO timeouts, delays, sleep
- NO retry loops, polling (especially `setInterval` for state sync!)
- NO timing-based solutions
- Use event-driven, synchronous operations instead
- ALWAYS prefer event callbacks over polling for UI state management

**Error Handling (MANDATORY)**
- NEVER use empty catch blocks
- Always log with context
- Provide actionable information

## Logging

### Configuration
```bash
RUST_LOG=schaltwerk=debug npm run tauri:dev  # Debug our code
RUST_LOG=trace npm run tauri:dev             # Maximum verbosity
```

### Location
macOS: `~/Library/Application Support/schaltwerk/logs/schaltwerk-{timestamp}.log`

### Best Practices
- Include context (IDs, sizes, durations)
- Log at boundaries and slow operations
- Never log sensitive data

## MCP Server Integration

- Use REST API only (never direct database access)
- Stateless design
- All operations through `src-tauri/src/mcp_api.rs`
- Rebuild after changes: `cd mcp-server && npm run build`

## Release Process

```bash
just release        # Patch release
just release minor  # Minor release
just release major  # Major release
```

Automatically updates versions, commits, tags, and triggers GitHub Actions.

## Development Workflow

1. Make changes
2. Run `npm run lint` (TypeScript)
3. Run `npm run lint:rust` (Rust)
4. Run `npm run test` (full validation)
5. Test: `npm run tauri:dev`
6. Only commit when all checks pass

## Important Notes

- Terminal cleanup is critical
- Each session creates 3 OS processes
- Document keyboard shortcuts in SettingsModal
- Performance matters - log slow operations
- No comments in code - self-documenting only
- Fix problems directly, no fallbacks/alternatives
- All code must be used now (no YAGNI)