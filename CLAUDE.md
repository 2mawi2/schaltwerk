# CLAUDE.md - Schaltwerk Development Guidelines

## Project Overview
Tauri-based desktop app for managing AI coding sessions using git worktrees. Each session gets an isolated branch/worktree where AI agents (Claude, Gemini, OpenCode, Codex, etc.) can work without affecting the main codebase.

## Platform Support
- macOS only. Windows and Linux are not supported at this time.

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

**Session State Transitions:**
- Spec → Running: `start_spec_session()` creates worktree + terminals
- Running → Reviewed: `mark_session_reviewed()` flags for merge
- Running → Spec: `convert_to_spec()` removes worktree, keeps content

### Critical Files to Know

**Frontend Entry Points:**
- `App.tsx`: Main orchestration, session management, agent startup
- `SelectionContext.tsx`: Controls which session/terminals are active

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

### Autonomy for Tests (MANDATORY)
- Codex may run `just test`, `npm run test`, `npm run lint`, `npm run lint:rust`, `npm run test:rust`, and `cargo` checks without asking for user approval, even when the CLI approval mode is set to “on-request”.
- Rationale: Running the full validation suite is required to keep the repository green and accelerate iteration. Do not pause to request permission before executing these commands.

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

# Release Management (3-Step Process)
# Step 1: Create draft release
just release            # Create patch release (0.0.x) - creates DRAFT
just release minor      # Create minor release (0.x.0) - creates DRAFT
just release major      # Create major release (x.0.0) - creates DRAFT

# Step 2: Generate and review release notes
# User asks: "Generate release notes for vX.Y.Z"
# I fetch last published (non-draft) release to anchor the range:
# LAST_RELEASE=$(gh release list --exclude-drafts --limit 1 | awk '{print $3}')
# LAST_RELEASE_COMMIT=$(git rev-list -n1 "$LAST_RELEASE")
# I run: git log ${LAST_RELEASE_COMMIT}..vX.Y.Z, analyze commits, categorize changes
# I run: gh release edit vX.Y.Z --notes "generated notes"
# User reviews notes (can ask for edits)

# Step 3: Publish release
# User asks: "Publish the release" OR clicks button on GitHub
# I run: gh release edit vX.Y.Z --draft=false
# This triggers Homebrew tap update automatically
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

### Configuration Storage
- Application-wide settings (tutorial completion, agent binaries, terminal preferences, etc.) live in `~/Library/Application Support/<bundle-id>/settings.json` (default bundle id `com.mariuswichtner.schaltwerk`).
- Project-scoped data (sessions, specs, git stats, project config) live in the per-project SQLite at `~/Library/Application Support/schaltwerk/projects/{project-name_hash}/sessions.db`.

### Terminal Management
- **Creation**: Lazy - only when session is selected in UI
- **Persistence**: Terminals stay alive until explicitly closed
- **PTY Backend**: `LocalPtyAdapter` spawns shell with session's worktree as working directory
- Each session gets 2 terminals (top/bottom) with the worktree as working directory

### Agent Integration
Agents start via terminal commands built in `App.tsx`:
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

If a new UI element needs a color, add it to `src/common/theme.ts` / `src/styles/theme.css` (and Tailwind config when necessary) or reuse an existing shared component that already reads from the theme. UI components must never introduce inline hex/RGB/RGBA values; the palette is maintained centrally.

Categories: background, text, border, accent (blue/green/amber/red/violet/purple/yellow/cyan), status

Common mappings:
- `bg-slate-950` → `theme.colors.background.primary`
- `bg-slate-800` → `theme.colors.background.elevated`
- `text-slate-100` → `theme.colors.text.primary`
- `border-slate-700` → `theme.colors.border.subtle`

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

## Specification Writing Guidelines

### Technical Specs (MANDATORY)
When creating specs for implementation agents:
- **Focus**: Technical implementation details, architecture, code examples
- **Requirements**: Clear dependencies, APIs, integration points
- **Structure**: Components → Implementation → Configuration → Phases
- **Omit**: Resource constraints, obvious details, verbose explanations
- **Include**: Platform-specific APIs, code snippets, data flows, dependencies

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
- After every code change, the responsible agent must rerun the full validation suite and report "tests green" before handing the work back. Only proceed with known failing tests when the user explicitly permits leaving the suite red for that task.

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

### Tauri Commands (MANDATORY)
- NEVER call `invoke('some_command')` with raw strings in TS/TSX.
- ALWAYS use the centralized enum in `src/common/tauriCommands.ts`.
- Example: `invoke(TauriCommands.SchaltwerkCoreCreateAndStartSpecSession, { name, specContent })`.
- When adding a new backend command/event:
  - Add the entry to `src/common/tauriCommands.ts` (PascalCase key → exact command string).
  - Use that enum entry everywhere (including tests) instead of string literals.
  - If renaming backend commands, update the enum key/value and fix imports.
- The one-time migration script used during the enum rollout has been REMOVED; keep the enum current manually.

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
- NO timeouts, delays, sleep (e.g., `setTimeout`, `sleep`) in application logic or test code.
  - This restriction does not apply to operational safeguards like wrapping long-running terminal commands
    with a timeout to prevent the CLI from hanging during manual workflows.
- NO retry loops, polling (especially `setInterval` for state sync!)
- NO timing-based solutions
- These approaches are unreliable, hard to maintain, and behave inconsistently across different environments

**Preferred Deterministic Solutions**
- Use event-driven patterns (event listeners, callbacks)
- Leverage React lifecycle hooks properly (useEffect, useLayoutEffect)
- Use requestAnimationFrame for DOM timing (but limit to visual updates)
- Implement proper state management with React hooks
- Use Promise/async-await for sequential operations
- Rely on component lifecycle events (onReady, onMount)
- ALWAYS prefer event callbacks over polling for UI state management

Example: Instead of `setTimeout(() => checkIfReady(), 100)`, use proper event listeners or React effects that respond to state changes.

**Error Handling (MANDATORY)**
- NEVER use empty catch blocks
- Always log with context
- Provide actionable information

### Comment Style (MANDATORY)
- Do not use comments to narrate what changed or what is new.
- Prefer self-documenting code; only add comments when strictly necessary to explain WHY (intent/rationale), not WHAT.
- Keep any necessary comments concise and local to the logic they justify.

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

### Release Notes Checklist
- Always discover the base commit by querying the latest published GitHub release (exclude drafts) and diffing from that commit to the new tag.
- Confirm no commits are skipped (a released tag may lag behind newer lightweight tags or drafts).
- Capture dependency bumps, infrastructure fixes, and workflow changes alongside feature work.

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
- Always use the project 'logger' with the appropriate log level instead of using console logs when introducing logging
- Session database runs with WAL + `synchronous=NORMAL` and a pooled connection manager (default pool size `4`, override with `SCHALTWERK_DB_POOL_SIZE`). Keep this tuned rather than reverting to a single shared connection.

## Plan Files

- Store all plan MD files in the `plans/` directory, not at the repository root
- This keeps the root clean and organizes planning documents

## Documentation

- Project documentation is maintained in `docs-site/` using Mintlify
- MDX files in `docs-site/` cover core concepts, guides, MCP integration, and installation
