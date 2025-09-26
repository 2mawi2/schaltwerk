# Session Merge to Main – Implementation Plan

## Objectives
- Implement backend commands to preview and execute session merges back into each session's parent branch, supporting squash and history-preserving flows.
- Ensure frontend can present merge previews, collect user confirmation, and surface deterministic feedback using existing event infrastructure and shared components.
- Deliver robust error handling and tests that guarantee clean session state transitions and single-toast UX without introducing telemetry requirements.

## Assumptions & Constraints
- Git CLI is available and callable from the Tauri backend; operations must complete within a 180 s timeout.
- Only reviewed sessions with `ready_to_merge=true` and clean worktrees are eligible.
- Event system enums (`SchaltEvent`, `TauriCommands`) remain the single source of truth for command/event names.
- No polling or timeouts for UI updates; reactions occur via events only.

## Backend Work (Rust)
1. **Domain Structure**
   - Add `merge` domain under `src-tauri/src/domains/` with service + command modules following project conventions.
   - Expose new Tauri commands in `main.rs` delegating to the domain layer; update `src/common/tauriCommands.ts` accordingly.

2. **Merge Preview Logic** (`schaltwerk_core_get_merge_preview`)
   - Query `SessionManager` for the session record and validate eligibility (state, worktree presence, cleanliness, diff).
   - Resolve target branch strictly from `session.parent_branch`; fail with actionable error when missing.
   - Build deterministic command arrays for both strategies using shared helpers so preview and execution stay aligned.
   - Return structured payload `{ parentBranch, sessionBranch, squashCommands, reapplyCommands }`.
   - Add unit tests covering eligible session, missing worktree, dirty worktree, missing parent branch, and no-diff cases.

3. **Merge Execution Logic** (`schaltwerk_core_merge_session_to_main`)
   - Acquire per-session merge lock (extend existing locking util or implement `MutexMap` keyed by session name).
   - Re-run eligibility + diff checks to avoid stale state.
   - For squash flow: perform soft reset, create a single commit with user-supplied message, and fast-forward the parent branch from that commit.
   - For history-preserving flow: replay session commits onto the latest parent branch and fast-forward the parent branch to match.
   - Prefer executing git operations through the integrated git library to minimize spawn overhead; fall back to CLI only when required.
   - Execute with timeout wrapper (180 s) while explicitly detecting and reporting conflicts with the updated parent branch.
   - On success: update session model (`ready_to_merge=false`, state back to running, refresh git stats) and emit `GitOperationStarted/Completed` plus `SessionsRefreshed`.
   - On failure: emit `GitOperationStarted/Failed` with stderr snippet; ensure no partial branch moves by hard reset/abort operations when possible.
   - Cover flows with focused unit tests for lock contention, conflict surfacing, and timeout handling.

4. **Helpers & Utilities**
   - Introduce shared git command builder that returns ordered commands for both preview and execution.
   - Implement last-error cache (per session) for deduping repeated failure emissions.

## Frontend Work (TypeScript/React)
1. **Command Enum Updates**
   - Extend `TauriCommands` enum with new backend command identifiers.
   - Ensure all invocations import from the enum (no string literals).

2. **Merge Dialog Component**
   - Create dialog under `src/components/sessions/` leveraging existing modal infrastructure and reusing existing session detail components where possible.
   - Display command previews for both strategies using an existing read-only list component.
   - Provide strategy selector, default commit message input (wired to shared helper), disabled states & tooltips for ineligible sessions.
   - Surface keyboard shortcut handler (`Cmd/Ctrl+Shift+M`) via existing hotkey system.

3. **SessionsContext/Event Handling**
   - Register single listener for `GitOperation` events when project context mounts; cleanup on unmount to avoid duplicate toasts (Strict Mode safe).
   - Map Started/Completed/Failed to deterministic toast titles/messages using event payloads. Respect last-error cache IDs for dedupe.
   - Trigger dialog open from action button + shortcut; ensure confirm button disables while merge in progress.

4. **State Synchronization**
   - On `SessionsRefreshed`, refresh session list and close modal if merge succeeded.
   - Update local session entry (`ready_to_merge=false`, state running) after successful event to avoid stale UI before next refresh.

## Testing Strategy
- **Backend**: Unit tests for eligibility + command list generation, lock handling, and conflict reporting.
- **Frontend**: Component tests for merge dialog rendering (Vitest + React Testing Library). Context tests verifying single listener registration and toast deduping (simulate double-render to mimic Strict Mode).
- **Manual Smoke**: Document steps to initiate merge, observe events, and simulate conflict scenario to verify failure toast.

## Risks & Mitigations
- Git operations may leave branches in inconsistent state → implement rollback helpers and run operations in temp clones during tests.
- Timeout mid-operation → wrap sequences in transactional pattern (pre-validate, fail-fast, detect partial work) and ensure clear failure messaging.
- Event duplication → enforce cleanup with `useEffect` return functions and caches.

## Open Questions
- None at this time.
