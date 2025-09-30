# Web Worker Syntax Highlighting - MVP Plan

## Problem
Synchronous highlight.js blocks main thread causing UI freezes on large diffs.

## Solution
Move syntax highlighting to Web Worker for non-blocking operation.

## What We're Building

### 1. Worker (`src/workers/syntaxHighlighter.worker.ts`)
- Imports highlight.js
- Receives code + language
- Returns highlighted HTML
- Simple request/response pattern

### 2. Hook (`src/hooks/useHighlightWorker.ts`)
- Creates and manages worker instance
- Provides `highlightCode(code, language)` function
- Handles worker errors (fallback to plain text)
- Cleans up worker on unmount

### 3. Update `UnifiedDiffModal.tsx`
- Replace sync `highlightCode` with hook
- Keep existing cache strategy
- Cache now stores highlighted results from worker
- No UI changes needed

## Implementation Steps

1. Create worker file with hljs
2. Create hook to communicate with worker
3. Replace highlightCode function in UnifiedDiffModal
4. Test with large diff
5. Run full test suite

## Expected Result

**Before:** 2-3s UI freeze on large files
**After:** Instant plain text, highlighted within ~200ms, no blocking

## Files to Create/Modify

**New:**
- `src/workers/syntaxHighlighter.worker.ts`
- `src/hooks/useHighlightWorker.ts`

**Modified:**
- `src/components/diff/UnifiedDiffModal.tsx` (swap highlightCode implementation)

## Success Criteria

- UI never freezes during highlighting
- Highlighting still works correctly
- Existing tests pass
- No visual regressions