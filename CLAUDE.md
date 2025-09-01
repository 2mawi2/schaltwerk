# CLAUDE.md - Schaltwerk Development Guidelines

## Project Overview
Tauri-based desktop app for managing Schaltwerk sessions with terminals, session management, and real-time monitoring.

## Essential Commands

### Before Completing ANY Task
```bash
just test          # ALWAYS run before considering task complete
# Or: npm run test
```

### Development
```bash
just test          # Validate all tests/lints (use for testing, NOT just test-all)
just run           # Start app (ONLY when user requests testing)
npm run tauri:dev  # Development mode
```

## Architecture

### Frontend: `src/`
- `components/`: React components (Terminal.tsx, TerminalGrid.tsx, RightPanelTabs.tsx, Sidebar.tsx)
- `hooks/`: Custom hooks (useSessionTerminals.ts, useSessionTerminalPair.ts)
- `App.tsx`: Main application

### Backend: `src-tauri/`
- `src/main.rs`: Entry point and Tauri commands
- `src/pty.rs`: Terminal PTY management
- `src/cleanup.rs`: Process cleanup
- `src/schaltwerk_core/git/`: Git operations (MUST use git2/libgit2, NEVER spawn git processes)

## Terminal Management

### ID Convention (REQUIRED)
```
orchestrator-{projectId}-top/bottom  # Orchestrator terminals
session-{name}-top/bottom            # Session terminals
```
- Each session: 2 terminals (top/bottom)
- Lazy creation, persistent state, proper cleanup
- Right panel: RightPanelTabs (not a terminal)

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
1. **Red**: Write failing test first
2. **Green**: Write minimal code to pass
3. **Refactor**: Improve while keeping tests green

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
- Include manual testing instructions in final summaries

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
- NO retry loops, polling
- NO timing-based solutions
- Use event-driven, synchronous operations instead

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