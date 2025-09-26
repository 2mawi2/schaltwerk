# Session Merge Conflict Detection – Plan

## Goals
- Detect merge conflicts that would occur when rebasing the session branch onto its parent before running the real merge.
- Surface a backend signal that distinguishes conflict, clean, and already-merged states so the UI can warn or auto-mark as merged without running git locally.
- Preserve existing merge execution paths (squash/reapply) and eligibility checks while minimizing new surface area for regressions.

## Current Pain Points
- The backend only validates cleanliness and divergence but does not simulate merging the parent into the session branch.
- Users discover conflicts only after manually attempting a merge (`git merge main`), causing duplicated effort and inconsistent warnings.
- UI cannot distinguish between "no diff" and "conflict" conditions, so the diff viewer may appear empty without a clear merged indicator.

## Backend Strategy (Rust)
1. **Conflict Simulation Helper**
   - Add utility in `domains::merge::service` (or new helper module) that:
     1. Opens the repository for the session.
     2. Resolves parent and session branch OIDs plus their merge base.
     3. Uses libgit2 (`Repository::merge_commits` or `merge_trees`) to compute a synthetic index representing `parent -> session` rebase.
     4. Checks the resulting index for conflicts without touching the on-disk worktree. Ensure we reset index state after inspection.
   - Return structured result `{ has_conflicts, is_up_to_date }`, where `is_up_to_date` is true if session fast-forwards from parent (no commits ahead) or if the simulated merge would yield an empty diff.

2. **Preview Contract Extension**
   - Extend `MergePreview` in `domains::merge::types` (and corresponding TS types) to include `has_conflicts: bool`, `is_up_to_date: bool`, and optionally a `conflicting_paths: string[]` sample (limit to a few entries for UX messaging).
   - Update `MergeService::preview` to call the simulation helper after existing eligibility checks.
   - Ensure `preview` differentiates:
     - Conflicts → keep merge options disabled / warn.
     - Already merged → surface `is_up_to_date` so UI can show "Merged" state.
     - Clean difference → proceed as today.

3. **Execution Guard**
   - Reuse the same helper inside `MergeService::merge` before acquiring locks/executing operations to fail fast with an actionable error if conflicts are detected.
   - When `is_up_to_date` is true, short-circuit with a success outcome that just clears `ready_to_merge` and emits completion events without running git commands.

4. **Domain Boundaries**
   - Keep helper logic inside merge domain; expose minimal API (e.g., `determine_merge_state(&repo, parent, session) -> MergeState`).
   - Reuse existing `branch_has_commits` and cleanliness checks; do not alter unrelated session validation.

## Frontend Strategy (TypeScript/React)
1. **Type Updates**
   - Update shared IPC types to consume `has_conflicts` and `is_up_to_date`.
   - Adjust merge dialog state machine: disable confirm button and show conflict banner when `has_conflicts` is true; show merged badge/tooltip when `is_up_to_date` is true.

2. **Diff Viewer Handling**
   - When dialog opens and `is_up_to_date` is true, display "Already merged" message instead of empty diff; leave diff viewer hidden or replaced with status callout.
   - Ensure conflict banner surfaces sample file list when provided.

3. **Event Feedback**
   - No new events required; rely on existing preview response + toasts triggered by merge commands.
   - If backend short-circuits merges for already merged sessions, emit `GitOperationCompleted` with metadata indicating `noop=true` so UI shows informative toast (optional follow-up if current payload supports it).

## Validation Plan
- **Rust tests**: Add unit tests for conflict detection helper covering conflict, clean, and up-to-date scenarios using temp repos with crafted histories.
- **Preview tests**: Extend existing merge service tests to assert new fields in `MergePreview` and ensure errors on conflict propagate correctly.
- **Frontend tests**: Update Vitest/RTL specs for merge dialog to assert conflict banner and merged status toggles.
- **Manual smoke**: Create sample session with clean merge, conflict, and already-merged states to verify dialog messaging without running full merges.

## Risks & Mitigations
- *Libgit2 conflict detection accuracy*: Validate against CLI `git merge-tree` in tests to ensure parity.
- *Performance*: Merge simulation runs synchronously; ensure it executes on blocking thread pool to avoid freezing async runtime.
- *Regression potential*: Guard with comprehensive tests and leave existing command sequences untouched.

## Open Questions
- Should we limit `conflicting_paths` to top N to avoid huge payloads?
- Do we need to track `last_conflict_check_timestamp` for telemetry or caching?

