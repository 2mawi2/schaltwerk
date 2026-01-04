# CLAUDE.md - Schaltwerk Development Guidelines

## Project Overview
Tauri-based desktop app for managing AI coding sessions using git worktrees. Each session gets an isolated branch/worktree where AI agents (Claude, GitHub Copilot CLI, Kilo Code, Gemini, OpenCode, Codex, Factory Droid, etc.) can work without affecting the main codebase.

## Platform Support
- macOS 11+ supported; Linux beta builds ship via releases.
- Windows 10 version 1903+ supported (ConPTY required).

> **Tooling Note:** Examples in this guide default to `bun`. Replace them with the equivalent `npm` commands (`npm install`, `npm run …`, etc.) if you prefer npm.

## Working Directory (CRITICAL)

**Your starting working directory is where you work. Do not navigate away from it.**

- Check `<env>` for your working directory and current branch
- If in a worktree (branch: `schaltwerk/*`): All files are here. Make changes here.
- If in main repo (branch: `main`): Work here directly.
- Do NOT infer parent paths from directory structure
- Do NOT `cd` to other locations unless explicitly required

❌ WRONG: `cd /inferred/path && command`
✅ RIGHT: `command` (in current directory)

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
2. `domains/sessions/service.rs:SessionManager::create_session()` → Creates DB entry + worktree
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
- `schaltwerk_core/mod.rs`: Session gateway + database access
- `domains/terminal/manager.rs`: PTY lifecycle management
- `domains/git/worktrees.rs`: Git worktree operations

**Communication Layer:**
- `eventSystem.ts`: Type-safe frontend event handling
- `events.rs`: Backend event emission
- `mcp_api.rs`: REST API for external MCP clients

### State Management (MANDATORY)
- Shared UI/application state lives in Jotai atoms under `src/store/atoms`; expose read-only atoms plus action atoms when updates require side effects.
- Example: `src/store/atoms/fontSize.ts` stores terminal/UI font sizes, updates CSS variables, emits `UiEvent.FontSizeChanged`, and persists via `SchaltwerkCoreSetFontSizes`.
- Reach for Jotai when state crosses components, needs persistence, or must be accessed from tests using the Jotai `Provider`/`createStore`; keep purely local state in React `useState`.
- Access atoms with `useAtomValue`, `useSetAtom`, or `useAtom` instead of creating new context providers for the same data.

## Essential Commands

### Before Completing ANY Task
```bash
just test          # Run ALL validations: TypeScript, Rust lints, tests, and build
# Or: bun run test  # Same as 'just test'
```
**Why:** Ensures code quality and prevents broken commits. The script runs TypeScript lint + type-checking, MCP lint/tests, frontend vitest, Rust clippy, dependency hygiene (`cargo shear`), `knip`, Rust tests (`cargo nextest`), and a Rust build.

### Autonomy for Tests (MANDATORY)
- Codex and Factory Droid may run `just test`, `bun run test`, `bun run lint`, `bun run lint:rust`, `bun run test:rust`, and `cargo` checks without asking for user approval, even when the CLI approval mode is set to “on-request”.
- Rationale: Running the full validation suite is required to keep the repository green and accelerate iteration. Do not pause to request permission before executing these commands.

### Development Commands
```bash
# Starting Development
bun run tauri:dev       # Start app in development mode with hot reload
RUST_LOG=schaltwerk=debug bun run tauri:dev  # With debug logging

# Testing & Validation
just test               # Full validation suite (ALWAYS run before commits)
bun run lint            # TypeScript linting only
bun run lint:rust       # Rust linting only (cargo clippy)
bun run deps:rust       # Rust dependency hygiene (cargo shear)
bun run test:rust       # Rust tests only (cargo nextest)

# Running the App
just run                # Start app (ONLY when user requests testing)
bun run tauri:build     # Build production app

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

# Release Notes Format:
## What's New in vX.Y.Z

### Features
- **Feature name** - Brief description (only if notable features)

### Improvements
- User-visible enhancements

### Fixes
- Fixed [specific issue]

### Maintenance
- Dependency updates (if any)

# Step 3: Publish release
# User asks: "Publish the release" OR clicks button on GitHub
# I run: gh release edit vX.Y.Z --draft=false
# This triggers Homebrew tap update automatically
```

### Command Context
- **Development:** Use `bun run tauri:dev` for active development with hot reload
- **Testing:** Always run `just test` before considering any task complete
- **Debugging:** Set `RUST_LOG` environment variable for detailed logging
- **Production:** Use `bun run tauri:build` to create distributable app

## How Things Actually Work

### Session Storage
Sessions use SQLite `sessions.db` under `~/Library/Application Support/schaltwerk/projects/{project-name_hash}` (macOS) or `~/.local/share/schaltwerk/projects/{project-name_hash}` (Linux) to store:
- Git branch + worktree path (`.schaltwerk/worktrees/{session-name}/`)
- Session state (Spec/Running/Reviewed)
- Spec content (markdown planning docs)
- Git stats (files changed, lines added/removed)

### Configuration Storage
- Application settings live in OS config (`~/Library/Application Support/com.mariuswichtner.schaltwerk/settings.json` on macOS, `~/.config/schaltwerk/settings.json` on Linux).
- Project-scoped data (sessions, specs, git stats, project config) reuse the same `sessions.db`.

### Terminal Management
- **Creation**: Lazy - only when session is selected in UI
- **Persistence**: Terminals stay alive until explicitly closed
- **PTY Backend**: `LocalPtyAdapter` spawns shell with session's worktree as working directory
- Each session gets 2 terminals (top/bottom) with the worktree as working directory
- **Terminal ID rules (critical)**: Terminal IDs are derived **only** from the session name (sanitized) and never include `projectPath`. Tracking caches must use the same ID scope; changing projects should **rebind**, not recreate, existing IDs. Avoid project-scoped cache keys for terminals to prevent resets/remounts.

#### Terminal Roles
- **Top terminal** (`TerminalGrid` mounts `terminals.top` from `SelectionContext`) runs the active agent process for the selected session. Switching sessions swaps this agent terminal so Claude, Codex, etc. always stay in the upper pane tied to that session.
- **Bottom terminals** (`TerminalTabs` manage `terminals.bottomBase`) are dedicated for user-driven shells. Tabs let the user open additional shells; selecting a different tab only swaps the bottom pane and leaves the top agent terminal untouched.
- Combined session switches update both panes together, ensuring the agent shell and the user shells follow the session, while per-tab switches affect only the bottom user terminals.

### Agent Integration
Agents start via terminal commands built in `App.tsx`:
- Each agent runs in session's isolated worktree

### MCP Server Webhook
- Runs on project-specific port (8547 + project hash)
- Receives notifications from external MCP clients
- Updates session states and emits UI refresh events


## UI Systems

### Theme System (MANDATORY)

**NEVER use hardcoded colors.** The app supports 10 themes—all colors must come from the theme system so they adapt when users switch themes.

**How to apply colors** (see `src/common/theme.ts` for available color names):
- Tailwind: `className="bg-primary text-primary border-subtle accent-blue"`
- CSS vars: `style={{ backgroundColor: 'var(--color-bg-elevated)' }}`
- TypeScript: `import { theme } from '../common/theme'` → `theme.colors.text.primary`

**Key files:**
- `src/styles/themes/*.css` - CSS variable definitions per theme (`[data-theme="x"]` selectors)
- `src/common/theme.ts` - TypeScript theme object
- `src/common/themes/` - Theme switching logic and presets

**Adding a new theme:** Create CSS file in `src/styles/themes/`, import in `theme.css`, add preset in `presets.ts`, register type in `types.ts`, add to `ThemeSettings.tsx`. Each color needs both hex and RGB values for Tailwind opacity support.

### Font Sizes (MANDATORY)
**NEVER use hardcoded font sizes.** Use theme system:
- Semantic: caption, body, bodyLarge, heading, headingLarge, headingXLarge, display
- UI-specific: button, input, label, code, terminal
- Import: `theme.fontSize.body` or `var(--font-body)`

**Typography helpers**
- All non-code UI text must use the shared system sans stack (`var(--font-family-sans)`, i.e., `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, etc.) and code/terminal text must use the mono stack (`var(--font-family-mono)`, i.e., `SFMono-Regular`, Menlo, Consolas, etc.). These stacks are wired through `theme.fontFamily`.
- Prefer the helpers in `src/common/typography.ts` to pair semantic sizes with the correct line heights. Session cards, spec headings, and terminal labels are guarded by `local/no-tailwind-font-sizes` so Tailwind `text-*` utilities are rejected—reuse those helpers when touching those files.

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
- When a user asks for a “spec” use the Schaltwerk MCP spec commands instead of creating local plan files. Only create Markdown plan files when the request explicitly mentions a plan file/`.md` output.

### Before ANY Commit
Run `bun run test` - ALL must pass:
- TypeScript linting
- Rust clippy
- Rust dependency hygiene (`cargo shear`)
- **Dead code detection** (`knip` - finds unused files, exports, and dependencies)
- Rust tests
- Rust build

**CRITICAL Rules:**
- Test failures are NEVER unrelated - fix immediately
- NEVER skip tests (no `.skip()`, `xit()`)
- Fix performance test failures (they indicate real issues)
- After every code change, the responsible agent must rerun the full validation suite and report "tests green" before handing the work back. Only proceed with known failing tests when the user explicitly permits leaving the suite red for that task.

**Dead Code Detection:**
- `knip` runs automatically as part of `bun run test`
- Reports unused files, exports, types, and dependencies
- Configured in `knip.json` to ignore test utilities and type declarations
- Use `--no-exit-code` flag to prevent blocking CI on warnings
- Review knip output regularly and clean up reported issues

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
- Example: `invoke(TauriCommands.SchaltwerkCoreCreateSession, { name, prompt })`.
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

### Single Source of Truth (CRITICAL)
When multiple components need to track shared state (e.g., "has this resource been initialized?"), use ONE centralized module. Never duplicate tracking across files.

- Example: Terminal start state lives in `src/common/terminalStartState.ts` - both `agentSpawn.ts` and `Terminal.tsx` use it
- Before adding a new Set/Map for tracking, check if one already exists and consolidate

### useEffect Dependencies (CRITICAL)
Unstable useEffect dependencies cause component remounts and double-execution:

- **Problem:** Values that start as `null` and update async (like fetched settings) trigger effect re-runs
- **Solution:** Initialize with synchronous defaults, or use refs for values that shouldn't trigger re-renders
- **Pattern:** For terminal config, we use Jotai atoms with synchronous defaults (`buildTerminalFontFamily(null)`) so the initial render has stable values

**Example of what NOT to do:**
```typescript
const [fontFamily, setFontFamily] = useState<string | null>(null) // Starts null!
useEffect(() => { loadSettings().then(s => setFontFamily(s.font)) }, [])
useEffect(() => { /* This runs TWICE - once with null, once with loaded value */ }, [fontFamily])
```

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
RUST_LOG=schaltwerk=debug bun run tauri:dev  # Debug our code
RUST_LOG=trace bun run tauri:dev             # Maximum verbosity
```

### Location
macOS: `~/Library/Application Support/schaltwerk/logs/schaltwerk-{timestamp}.log`

### Quick Access
- Each backend launch prints the log path; grab the latest file with:
  ```bash
  LOG_FILE=$(ls -t ~/Library/Application\ Support/schaltwerk/logs/schaltwerk-*.log | head -1)
  tail -n 200 "$LOG_FILE"
  ```
- Works from main or any session worktree—no repo navigation required.
- Frontend calls log through `src/utils/logger.ts`; entries show up with a `[Frontend]` prefix in the same file.

### Best Practices
- Include context (IDs, sizes, durations)
- Log at boundaries and slow operations
- Never log sensitive data

## MCP Server Integration

- Use REST API only (never direct database access)
- Stateless design
- All operations through `src-tauri/src/mcp_api.rs`
- Rebuild after changes: `cd mcp-server && bun run build`

## Release Process

```bash
just release        # Patch release
just release minor  # Minor release
just release major  # Major release
```

Automatically updates versions, commits, tags, and triggers GitHub Actions.

### Release Notes Checklist
- Base commit: Query latest published release (exclude drafts)
- Capture all commits: dependencies, infrastructure, features
- Use format from Step 2 above (Features/Improvements/Fixes/Maintenance)
- No installation instructions in release body

## Development Workflow

1. Make changes
2. Run `bun run lint` (TypeScript)
3. Run `bun run lint:rust` (Rust)
4. Run `bun run test` (full validation)
5. Test: `bun run tauri:dev`
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
- If you create plans research the codebase or requested details first before making a plan for the implementation
- Don't make plans for making plans, rather do the planning ahead and then implement

## Documentation

- Project documentation is maintained in `docs-site/` using Mintlify
- MDX files in `docs-site/` cover core concepts, guides, MCP integration, and installation
