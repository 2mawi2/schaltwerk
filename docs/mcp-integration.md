# MCP Integration

Schaltwerk ships with a Model Context Protocol (MCP) REST API so external tools can automate session management.

## API Basics
- Runs on `localhost` using port `8547 + <project-hash>` to avoid collisions.
- Handles creating and updating specs, starting sessions, and refreshing the UI.
- Emits structured events that the frontend consumes via the type-safe event system.

## Typical Flow
1. An MCP client sends a request to the Schaltwerk REST endpoint to create or update a spec.
2. The backend records the change in the SQLite database and emits `SessionsRefreshed`.
3. The frontend updates automatically; optional `Selection` events can focus the new session.

## Orchestrated Workloads
Use the MCP API to:
- Break down large initiatives into multiple specs.
- Launch agents in parallel across different specs.
- Monitor completion and collect the resulting worktrees for review.

## Development Notes
- Backend logic lives in `src-tauri/src/mcp_api.rs` and reuses the same session manager that powers the UI.
- Events are defined in `src-tauri/src/events.rs` and consumed through `src/common/eventSystem.ts`.
- There is no direct database access from external tools—everything flows through the REST surface.
