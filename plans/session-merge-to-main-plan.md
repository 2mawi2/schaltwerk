# Session Merge to Main – Requirements Blueprint Plan

## Objectives
- Deliver backend + frontend support for the reviewed session merge workflow described in the blueprint.
- Fix stale merge/conflict button state so it reflects reviewed eligibility after status transitions, file watcher updates, merge attempts, and initial project load.
- Maintain deterministic UX (single toasts, stable progress states) while supporting squash & reapply strategies.

## Discovery & Alignment
1. Audit current merge readiness sources:
   - Inspect `session_core.rs` for how `ready_to_merge`, conflict flags, and git stats are calculated and persisted.
   - Trace `watchers` → `SessionGitStats` emission to confirm when the frontend receives updates on file changes.
   - Review `SessionsContext.tsx` merge state handling (`mergeStatuses`, dialog flow, toast dedupe) and the components rendering the merge/conflict button.
2. Catalogue existing Tauri commands/events touching merge state to ensure we reuse or extend rather than duplicate logic.
3. Confirm keyboard shortcut + dialog entry points so UX changes remain consistent.

## Backend Work
1. Implement `schaltwerk_core_get_merge_preview` and `schaltwerk_core_merge_session_to_main` with lock + timeout semantics described in the blueprint.
   - Leverage git worktree helpers in `git/worktrees.rs` and ensure both strategies return ordered command previews.
   - Reset `ready_to_merge` and refresh git stats on success; emit GitOperation events with telemetry payload (commands, branch names, duration).
2. Ensure session readiness recomputes on:
   - Transition to `reviewed` (e.g., `mark_session_reviewed` path).
   - File watcher deltas (propagate clean/dirty/conflict info back through `SessionGitStats`).
   - Merge attempts (update conflict/merged states on start/failure/success).
   - Initial load (DB → enriched session struct should carry accurate `ready_to_merge`, conflict, and diff stats fields).
3. Harden error paths for missing worktree, deleted branch, git unavailable, rebase conflicts, and timeout rollback; emit `GitOperationFailed` with actionable `stderr` snippets and dedup cache keys.

## Frontend Work
1. Update `SessionsContext` to recompute merge/conflict availability when:
   - `ready_to_merge` toggles in session data.
   - `SessionGitStats` arrives after watcher diffs (clean → dirty, dirty → clean, conflicts).
   - User opens/confirm merge dialog (ensure previews reset cached state on each attempt).
   - Reviewed sessions load on app start or project switch.
2. Ensure merge button (and any conflict badge) in diff/session list consumes the updated context state.
   - Audit `DiffSessionActions` (and related components) to guarantee re-render on status changes via stable references or `MergeStatus` map updates.
3. Verify GitOperation toasts remain single-fire by scoping listeners per project and clearing caches on project change.
4. Surface merge preview command lists, commit message defaults, and disabled states exactly as specified.

## Testing Strategy (TDD)
1. Backend: add unit/integration tests for both merge strategies covering success, timeout, conflicts, missing worktree, and no-diff cases.
2. Backend: test the merge lock to ensure concurrent requests block with deterministic errors.
3. Frontend: extend Jest/Vitest coverage for `SessionsContext` or hooks to assert merge/conflict state recalculates for the four trigger scenarios.
4. Frontend: test the merge dialog rendering of command previews, disabled states, and toast dedupe behavior.
5. Manual smoke: follow blueprint validation checklist (start merge, observe events, simulate conflicts) before marking complete.

## Telemetry & Follow-Ups
- Attach branch names, executed command array, duration, and outcome to GitOperation events for downstream logging.
- Cache last failure per session to suppress duplicate error toasts while still logging server-side.
- Track open questions (copy-to-clipboard, analytics, observability counters) for follow-up discussion.
