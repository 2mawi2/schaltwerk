# CLAUDE.md - Schaltwerk Development Guidelines

This file provides guidance to Claude Code when working with the Schaltwerk codebase.

## Project Overview

Schaltwerk is a Tauri-based desktop application that provides a visual interface for managing Schaltwerk sessions. It features multiple terminal panels, session management, and real-time status monitoring.

## Essential Development Commands

### Before Completing ANY Agent

**IMPORTANT**: Always run these commands before considering a agent complete:

```bash
# Run all tests and lints (PREFERRED METHOD)
just test

# Or use npm directly:
npm run test

# Or individually:
npm run lint          # TypeScript type checking
npm run lint:rust     # Rust clippy linting
npm run build:rust    # Rust compilation check
```

### Development Commands

```bash
# Test the application (ALWAYS use this for validation)
just test             # Run all tests, lints, and build checks

# Run the application (let user test functionality)
just run              # Start the full Tauri application

# Alternative npm commands:
npm run dev           # Start Vite dev server
npm run build         # Build TypeScript/React frontend
npm run tauri dev     # Run full Tauri app in development mode
npm run check         # Full check (alias for npm run test)
```

## Architecture Overview

### Frontend (React/TypeScript)
```
src/
├── components/       # React components
│   ├── Terminal.tsx  # Core terminal renderer using xterm.js
│   ├── TerminalGrid.tsx  # Main dual-terminal layout (top and bottom)
│   ├── RightPanelTabs.tsx  # Right panel with Changes/Agents tabs
│   └── Sidebar.tsx   # Session list and navigation
├── hooks/           # Custom React hooks
│   ├── useSessionTerminals.ts     # Single terminal management
│   └── useSessionTerminalPair.ts  # Dual terminal management
└── App.tsx          # Main application component
```

### Backend (Rust/Tauri)
```
src-tauri/
├── src/
│   ├── main.rs      # Tauri app entry point and commands
│   ├── pty.rs       # Terminal PTY management
│   └── cleanup.rs   # Process cleanup on exit
└── Cargo.toml       # Rust dependencies
```

## Key Features

### Terminal Management
- **Session-aware terminals**: Each session has 2 terminals (top and bottom)
- **Lazy creation**: Terminals created only when first needed
- **Persistent state**: Terminals keep running when switching sessions
- **Proper cleanup**: All processes killed when app exits
- **Right panel**: Not a terminal - shows Changes/Diffs for sessions or Agents/Plans for commander

### Terminal ID Convention (required)
```
Commander:
- commander-{projectId}-top
- commander-{projectId}-bottom

Sessions:
- session-{name}-top
- session-{name}-bottom
```

Note: The commander terminals include a project-specific ID hash to ensure separate terminals per project. The right panel is RightPanelTabs component showing diffs/agents, not a terminal.

## Testing Requirements

### Test-Driven Development (TDD)

**MANDATORY**: Follow red-green-refactor cycle for all new code:

1. **Red**: Write a failing test first that defines the expected behavior
2. **Green**: Write minimal code to make the test pass
3. **Refactor**: Improve code while keeping tests green

**TDD Rules**:
- Never write production code without a failing test
- Write only enough test code to make it fail
- Write only enough production code to make the test pass
- All tests must remain green after each implementation step
- No workarounds or skipped tests - fix issues immediately

**Benefits**:
- Ensures complete test coverage through red-green cycle
- Provides immediate feedback on implementation correctness
- Prevents untested code from entering the codebase
- Creates a safety net for future refactoring

### Before ANY Commit

**MANDATORY**: Run `npm run test` and ensure it passes completely. This command runs:
1. **TypeScript linting**: `npm run lint` - TypeScript must compile with no errors
2. **Rust linting**: `npm run lint:rust` - Clippy must pass with no warnings  
3. **Rust tests**: `npm run test:rust` - All unit tests must pass
4. **Rust build**: `npm run build:rust` - Must compile successfully

Never consider a task complete unless `npm run test` passes without errors.

**CRITICAL**: Test failures are NEVER unrelated. All tests must be green before:
- Committing any changes
- Merging any branches
- Considering any agent complete

If tests are failing, they must be fixed immediately. Do not assume test failures are from previous changes or unrelated work. Every test failure indicates a real problem that must be resolved.

**NEVER SKIP TESTS**: Under NO circumstances should you use `.skip()`, `xit()`, or any other mechanism to skip failing tests. If a test is failing:
1. Fix the implementation to make the test pass, OR
2. Fix the test to match the new expected behavior, OR  
3. Delete the test if it's genuinely no longer needed
But NEVER skip tests. Skipping tests is not a solution - it's avoiding the problem.

**NEVER SKIP TESTS**: Under NO circumstances should you use `.skip()`, `xit()`, or any other mechanism to skip failing tests. If a test is failing:
1. Fix the implementation to make the test pass, OR
2. Fix the test to match the new expected behavior
But NEVER skip tests. Skipping tests is not a solution - it's avoiding the problem.

### Performance Test Failures

**CRITICAL**: Performance tests are indicators of actual performance issues and must be treated seriously:
- **Fix the performance issue**: When performance tests fail, investigate and fix the underlying performance problem
- **Never ignore performance tests**: Do not skip or disable failing performance tests
- **Exception for obsolete tests**: Only delete a performance test if it no longer makes sense (e.g., testing removed functionality)
- **Performance regressions matter**: Slower performance affects user experience and must be addressed

### Common Issues to Check
- Unused imports (both TypeScript and Rust)
- Missing JSX configuration in tsconfig.json
- Unhandled async/await in Tauri commands
- Terminal cleanup on app exit
- Memory leaks from event listeners

## Code Style Requirements

### TypeScript/React
- Use functional components with hooks
- Extract reusable logic into custom hooks
- Proper TypeScript types (avoid `any`)
- Clean up event listeners in useEffect
- Handle errors gracefully

### Rust
- Use `Result<T, String>` for Tauri commands
- Proper async/await handling
- Clean up resources (PTY processes, file handles)
- No clippy warnings allowed
- Use `#[warn(unused_imports)]` directive

## Critical Implementation Details

### Terminal Lifecycle
1. **Creation**: PTY process spawned on first session access
2. **Switching**: Frontend switches terminal IDs, backend processes persist
3. **Cleanup**: All processes killed via cleanup module on app exit

### Event System

#### Architecture Pattern
The app uses **Tauri events** for backend-to-frontend communication. NEVER use DOM events (`window.addEventListener`) for inter-component communication - always emit events from the backend.

#### Key Tauri Events
- `schaltwerk:sessions-refreshed`: Backend emits with full session list when sessions change (create/delete/state change)
- `schaltwerk:session-removed`: Backend emits when a session is deleted
- `schaltwerk:selection`: Frontend selection changes
- `terminal-output-{id}`: Terminal output streaming from backend

#### Implementation Pattern
When session state changes in backend:
1. Backend command performs the operation
2. Backend emits `app.emit("schaltwerk:sessions-refreshed", sessions)`
3. Frontend components listen via `listen()` from `@tauri-apps/api/event`
4. Components refresh their state when event received

Example backend:
```rust
#[tauri::command]
async fn schaltwerk_core_start_draft_session(app: tauri::AppHandle, name: String) -> Result<(), String> {
    // ... perform operation ...
    if let Ok(sessions) = manager.list_enriched_sessions() {
        app.emit("schaltwerk:sessions-refreshed", &sessions)?;
    }
    Ok(())
}
```

Example frontend:
```typescript
import { listen } from '@tauri-apps/api/event'

useEffect(() => {
    const unlisten = await listen('schaltwerk:sessions-refreshed', (event) => {
        setSessions(event.payload)
    })
    return () => { unlisten() }
}, [])

### Known Issues
- Terminal resize events need debouncing to prevent flicker
- Initial terminal size must match container dimensions
- Visibility detection prevents inactive terminals from processing input

## Development Workflow

1. Make changes
2. Run `npm run lint` to check TypeScript
3. Run `npm run lint:rust` to check Rust code
4. Run `npm run test` for full validation
5. Test in dev mode: `npm run tauri dev`
6. Only commit when all checks pass

## Important Notes

- **Never skip the test step**: Running `npm run test` before commits prevents broken builds
- **Terminal cleanup is critical**: Always ensure PTY processes are properly terminated
- **Session persistence**: Terminals should survive session switches but not app restarts
- **Resource management**: Each session creates 3 OS processes - handle with care

## Common Agents

### Adding a new terminal panel
1. Create new component using `Terminal` component
2. Use `useSessionTerminals` hook for session awareness
3. Follow naming convention: `{context}-{position}`
4. Ensure cleanup in backend

### Debugging terminal issues
1. Check browser console for JavaScript errors
2. Check Tauri console for Rust errors
3. Verify terminal IDs match expected format
4. Use `ps aux | grep -E "zsh|bash|fish"` to check for orphaned processes
5. Check application logs (see Logging section below)

### Performance optimization
1. Minimize resize events with debouncing
2. Use visibility detection to pause inactive terminals
3. Lazy-create terminals only when needed
4. Properly dispose xterm.js instances

## Logging

### Overview
The application uses the Rust `log` crate with `env_logger` for comprehensive logging. Logs are written to both stderr (console) and a timestamped file for persistent debugging.

### Log File Location
Log files are automatically created at application startup:
- **macOS**: `~/Library/Application Support/schaltwerk/logs/schaltwerk-{timestamp}.log`
- **Linux**: `~/.local/share/schaltwerk/logs/schaltwerk-{timestamp}.log`

Note: Currently only macOS is officially supported.

The exact log file path is printed to stderr when the app starts with a 📝 emoji prefix.

### Log Levels
The application uses standard log levels with smart defaults:
- **DEBUG**: Detailed information for our codebase (`schaltwerk` modules)
- **INFO**: Important events and milestones (default for `portable_pty`, `tauri`)
- **WARN**: Potentially harmful situations (default for third-party crates)
- **ERROR**: Error events that might still allow the app to continue
- **TRACE**: Very detailed debugging (disabled by default)

### Configuring Log Levels
Set the `RUST_LOG` environment variable to override defaults:
```bash
# Maximum verbosity for everything
RUST_LOG=trace npm run tauri dev

# Debug our code, warn for everything else
RUST_LOG=schaltwerk=debug,warn npm run tauri dev

# Only errors
RUST_LOG=error npm run tauri dev

# Debug specific module
RUST_LOG=schaltwerk::terminal=trace npm run tauri dev
```

### Log Format
Logs use a consistent format for easy parsing:
```
[YYYY-MM-DD HH:MM:SS.mmm LEVEL module::path] Message
```

Example:
```
[2024-01-15 14:23:45.123 INFO  schaltwerk::terminal] Creating terminal: id=commander-top, cwd=/Users/name/project
[2024-01-15 14:23:45.456 DEBUG schaltwerk::terminal] Saved child process for terminal commander-top
[2024-01-15 14:23:45.789 WARN  schaltwerk::terminal] Terminal commander-bottom slow write: 25ms
```

### Logging in Rust Code
Use the appropriate macros from the `log` crate:

```rust
use log::{debug, info, warn, error};

// Informational messages for important events
info!("Terminal created successfully: id={id}");

// Debug messages for detailed flow tracking
debug!("Resizing terminal {id}: {cols}x{rows}");

// Warnings for recoverable issues
warn!("Terminal {id} slow write: {}ms", elapsed.as_millis());

// Errors for serious problems
error!("Failed to spawn terminal {id}: {e}");
```

### Best Practices
1. **Use structured logging**: Include relevant context (IDs, sizes, durations)
2. **Log at boundaries**: Entry/exit of major operations
3. **Performance metrics**: Log slow operations with timing
4. **Error context**: Always include error details and affected resources
5. **Avoid sensitive data**: Never log passwords, tokens, or user data

### Common Log Patterns

#### Terminal Lifecycle
```
INFO Creating terminal: id=session-main-top, cwd=/path
DEBUG Marked terminal session-main-top as being created
INFO Successfully spawned shell process for terminal session-main-top
DEBUG Saved child process for terminal session-main-top
INFO Terminal created successfully: id=session-main-top
```

#### Performance Issues
```
WARN Terminal commander-bottom slow write: 25ms
DEBUG Terminal commander-top slow buffer append: 15ms
```

#### Error Handling
```
ERROR Failed to spawn terminal session-test: Permission denied
WARN Failed to kill terminal process session-old: No such process
```

### Viewing Logs
```bash
# View latest log file (macOS)
tail -f ~/Library/Application\ Support/schaltwerk/logs/schaltwerk-*.log

# Filter for errors only
grep ERROR ~/Library/Application\ Support/schaltwerk/logs/schaltwerk-*.log

# Watch for specific terminal
grep "commander-top" ~/Library/Application\ Support/schaltwerk/logs/schaltwerk-*.log

# Monitor performance issues
grep -E "slow|WARN|ERROR" ~/Library/Application\ Support/schaltwerk/logs/schaltwerk-*.log
```

### Debugging Tips
1. **Start with INFO level**: Default configuration shows important events
2. **Enable DEBUG for issues**: `RUST_LOG=schaltwerk=debug` for detailed flow
3. **Check timing**: Look for "slow" operations indicating performance issues
4. **Follow IDs**: Track specific terminal IDs through their lifecycle
5. **Check cleanup**: Ensure terminals in logs are properly closed


## MCP Server Integration

### Architecture Principles
- **MCP server must use REST API calls only**: Never directly access the SQLite database
- **Stateless design**: MCP server should be a stateless HTTP client to the Rust backend
- **Database operations**: All session/plan operations must go through `src-tauri/src/mcp_api.rs` endpoints

### MCP Development Workflow
```bash
# After making changes to MCP server TypeScript code:
cd mcp-server
npm run build          # Rebuild MCP server
# Then restart your MCP client/application to pick up changes
```

### Key API Endpoints
- `POST /api/plans` - Create plan session
- `PATCH /api/plans/{name}` - Update plan content (supports append=true)
- `POST /api/plans/{name}/start` - Start plan as active session
- `DELETE /api/plans/{name}` - Delete plan session

### Performance Patterns
- **Use atomic operations**: For plan content updates, use `append_draft_content()` instead of get-then-update pattern
- **Avoid double database calls**: All operations should be single transactions where possible

### Webhook Integration
- `POST /webhook/plan-created` - When plan is created
- `POST /webhook/session-added` - When session becomes active
- `POST /webhook/session-removed` - When session is deleted

## Keyboard Shortcuts Documentation

When adding new keyboard shortcuts to the application, ensure they are also documented in the SettingsModal (`src/components/modals/SettingsModal.tsx`) to keep the keyboard shortcuts reference up-to-date.

## Release Process

### Creating a New Release

To release a new version of Schaltwerk:

```bash
# Automatic patch release (0.1.0 -> 0.1.1)
just release

# Minor release (0.1.0 -> 0.2.0)
just release minor

# Major release (0.1.0 -> 1.0.0)
just release major

# Specific version
just release 1.2.3
```

This command automatically:
- Updates version in `tauri.conf.json` and `Cargo.toml`
- Commits the version bump
- Creates and pushes a git tag
- Triggers GitHub Actions to build and distribute

3. **GitHub Actions Automation**
   The release workflow will automatically:
   - Build universal macOS binary (Intel + ARM)
   - Create ad-hoc signed DMG
   - Create GitHub release with artifacts
   - Update `2mawi2/homebrew-tap` repository

4. **Manual Trigger (Alternative)**
   ```bash
   # Go to Actions tab on GitHub
   # Select "Release" workflow
   # Click "Run workflow"
   # Enter version (e.g., 0.1.0)
   ```

### Prerequisites for Releases
- **HOMEBREW_TAP_TOKEN**: GitHub secret with repo access to `2mawi2/homebrew-tap`
- **Repository Access**: Write permissions to both repos

### Distribution
Users install via Homebrew:
```bash
brew tap 2mawi2/tap https://github.com/2mawi2/homebrew-tap
brew install --cask schaltwerk
open -a Schaltwerk
```

### Testing MCP Changes
```bash
# Test MCP plan creation
echo '{"name": "test-plan", "content": "# Test Plan"}' | json_pp
# Verify plan appears in UI plans section, not running sessions

# Test API endpoints directly
curl -X POST http://127.0.0.1:8547/api/plans -H "Content-Type: application/json" -d '{"name":"test","content":"test"}'
```

### Code Quality

- Do not write comments, ensure we have self-documenting code.
- Avoid writing fallbacks or alternative solutions to solve them. Rather fix them directly.
- Never write altnerative file names, functions or components. Rather fix them directly.
- Ask the user if problems seem impossible or difficult to solve for advice.
- Always develop deterministic solutions and never heuristics.
- Never use #[allow(dead_code)] Implement real implementations and unused code you can delete if we do not need it anymore.
- Never introduce YAGNI: Code that eventually will be needed in the future but not now, all the code must be used and referenced now
- Never implement non-deterministic fallbacks for external CLIs (e.g., simulating key presses, pasting text).
  If a CLI feature is required (like an interactive prompt flag), upgrade the dependency and use the official flag instead of workarounds.

#### Error Handling Requirements

**MANDATORY**: All catch blocks must properly handle errors:
- **NEVER use empty catch blocks** - Every catch must log the error or re-throw it
- **Always log errors with context** - Include the operation being performed and relevant identifiers
- **Use appropriate log levels** - `console.error` for critical failures, `console.warn` for recoverable issues
- **Provide actionable information** - Include enough context to debug the issue

Example of proper error handling:
```typescript
try {
    await someOperation();
} catch (error) {
    console.error(`[Component ${componentId}] Failed to perform operation:`, error);
    // Handle the error appropriately or re-throw
}
```

**NEVER do this:**
```typescript
try {
    await someOperation();
} catch (e) {
    // Silent failure - UNACCEPTABLE
}
```