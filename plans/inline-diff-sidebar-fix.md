# Inline Diff Sidebar Fix Plan

## Objectives
- Keep the inline review panel responsive when the selected session changes, especially when incoming sessions have no changed files.
- Prevent the sidebar flavor of the diff viewer from hijacking OS-level shortcuts such as ⌘↑/⌘↓ while still letting the modal view keep its keyboard navigation.
- Preserve the current UX contracts (inline preferred by default via checkbox, modal button available, no spec content while reviewing).

## Current Pain Points
1. `SimpleDiffPanel` unmounts `DiffFileList` once review mode is active. When the user switches sessions while still reviewing, there is no component left to refresh the file list, so `hasFiles` never updates and the inline viewer stays stuck on the loading screen.
2. When we previously tried to mirror the diff into review mode, `onFilesChange(false)` fired immediately (before network results), which forced an unwanted bounce back to the list even though files existed. We need a debounce that waits until the first load completes.
3. `UnifiedDiffView` captures ArrowUp/ArrowDown globally. In sidebar mode this blocks macOS shortcuts (⌘↑ / ⌘↓) that jump to top/bottom because the handler does not check modifiers and always `preventDefault`.

## Implementation Steps
1. **Add regression coverage**
   - Extend `SimpleDiffPanel.test.tsx` with a new case that keeps the component in review mode and simulates `onFilesChange(false)` to assert that `onModeChange('list')` fires. Use `vi.doMock` to control a lightweight fake `DiffFileList` so the test focuses on the panel logic.
2. **Keep file watcher alive in review mode**
   - In `SimpleDiffPanel.tsx`, always mount a `DiffFileList` instance. When the user is in review mode, render it inside a visually-hidden container so it keeps listening for session changes without showing UI. Pass `selectedFilePath`, `onFilesChange`, and a no-op `onFileSelect` while hidden.
3. **Avoid premature "no files" signals**
   - Inside `DiffFileList.tsx`, track `hasLoadedInitialResult`. Only call `onFilesChange` after the first successful load (or explicit project/session reset). Update this flag whenever we apply actual results so hidden instances do not spam `false` before data is ready.
4. **Exit review automatically when files disappear**
   - Re-use the existing `useEffect` inside `SimpleDiffPanel` (`if mode==='review' && !hasFiles`). With the hidden list + guarded callback, this hook will now trigger reliably when switching into sessions without diffs.
5. **Restore OS shortcuts while reviewing inline**
   - In `UnifiedDiffView.tsx`, update the global `keydown` handler:
     - Skip the ArrowUp/ArrowDown navigation block entirely when `viewMode === 'sidebar'`.
     - Additionally, bail out when `event.metaKey || event.ctrlKey || event.altKey || event.shiftKey` so modifier combinations are never intercepted.
   - Keep modal behavior unchanged so full-screen diff still supports keyboard navigation.
6. **Verification**
   - Run the expanded unit tests (`bun run test` per repo policy). Manually sanity-check (if possible) by switching sessions in review mode and ensuring the panel returns to the file list and keyboard shortcuts behave.

## Open Questions
- Do we need to persist scroll position across mode switches? User deferred earlier; we will leave it untouched unless requested again.
- Should the hidden `DiffFileList` also mirror selection state for analytics? Currently we pass `selectedFilePath` so highlights remain consistent when returning to the list.
