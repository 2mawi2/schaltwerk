# Terminal ID Consistency & Reset Hardening Plan

## Goal
Eliminate terminal resets caused by cache-key vs terminal-ID divergence and transient spec/missing state blips after spec→running promotion. All tracking should hinge on stable terminal IDs derived from session names.

## Core Changes
1) **Re-key terminal tracking by ID**
   - Track terminalsCache / terminalToSelection bindings by terminal ID only (drop projectPath/selectionCacheKey as primary key).
   - Keep a lightweight map terminalId → { sessionId, projectPath } for reference (non-authoritative).
   - On projectPath change, reuse existing IDs without recreating or closing registry instances.

2) **Selection flow adjustments**
   - Compute terminal IDs as today via `sessionTerminalGroup` but stop embedding projectPath into tracking keys.
   - When switching selection: if `hasTerminalInstance(id)` is true, rebind to tracking maps and skip backend creation.
   - Only call `createTerminalBackend` when an ID is neither tracked nor present in the registry.

3) **Release logic alignment**
   - `clearTerminalTrackingActionAtom` operates on terminal IDs, updates ID-based caches, and only closes backend if the registry has the ID.
   - Ensure `releaseSessionTerminals` remains ID-scoped and cannot be triggered by selection-key drift.

4) **Transient spec/missing confirmation**
   - Before clearing terminals on a spec or missing state right after promotion: force-refresh snapshot + check worktree exists.
   - Require two consecutive spec/missing observations within a short window to clear; log the first as ignored.

5) **Tests**
   - Selection tests: projectPath change after terminal creation does not call `createTerminalBackend`; IDs remain stable.
   - Spec-flap tests: running → spec (single blip) does not close; second consecutive spec does.
   - Missing-on-first-refresh test: does not release terminals if registry still has the ID.

## Acceptance
- Switching sessions or projectPath no longer recreates existing terminal IDs.
- Single spec/missing blip post-promotion does not close terminals; confirmed by tests.
- Registry retains ID continuity across selection changes; no unexpected resets observed in CI switch loops.
