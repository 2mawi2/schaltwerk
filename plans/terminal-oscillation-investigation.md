# Terminal Oscillation Bug Investigation

## Problem
TUI-based agent terminals (Kilocode, Claude Code) exhibit visual jumping/oscillation behavior.

## Root Cause (IDENTIFIED)

The `\x1b[3J` (CLEAR_SCROLLBACK_SEQ) sequence from TUI applications causes xterm.js to:
1. Clear the scrollback buffer
2. Reset `baseY` and `viewportY` to 0
3. Cause a dramatic viewport jump (delta=-2000 in logs)

This was confirmed by logs showing `OSCILLATION DETECTED` with `delta=-2000` immediately after `CLEAR_SCROLLBACK_SEQ detected`.

## Fixes Applied

### 1. DA Response Loop (FIXED)
**File:** `src-tauri/src/domains/terminal/control_sequences.rs`

- Primary DA responses (`\x1b[?1;2c`) now dropped instead of echoed back
- Secondary DA responses with params now dropped
- Only DA *queries* receive responses

### 2. Selective Logging (ADDED)
**File:** `src-tauri/src/domains/terminal/control_sequences.rs`

- DEBUG-level logging for unknown/unexpected escape sequences only
- Known sequences pass through silently

### 3. Strip CLEAR_SCROLLBACK_SEQ for TUI Terminals (FIXED)
**File:** `src/terminal/registry/terminalRegistry.ts`

For TUI mode terminals, the `\x1b[3J` sequence is stripped from output before writing to xterm.js. This prevents the viewport reset that causes jumping.

```typescript
if (chunk.includes(CLEAR_SCROLLBACK_SEQ)) {
  if (record.xterm.isTuiMode()) {
    processedChunk = chunk.split(CLEAR_SCROLLBACK_SEQ).join('');
  } else {
    // Standard terminal behavior unchanged
    record.pendingChunks = [];
    record.hadClearInBatch = true;
  }
}
```

### 4. TUI Agent Registry (ADDED)
**File:** `src/types/session.ts`

Created a centralized list of TUI-based agents and helper function:

```typescript
export const TUI_BASED_AGENTS: readonly AgentType[] = ['kilocode', 'claude'] as const

export function isTuiAgent(agentType: string | null | undefined): boolean {
    if (!agentType) return false
    return TUI_BASED_AGENTS.includes(agentType as AgentType)
}
```

### 5. Updated TUI Mode Detection (REFACTORED)
**Files:** `src/components/terminal/Terminal.tsx`, `src/hooks/useTerminalConfig.ts`

Changed from `agentType === 'kilocode'` to `isTuiAgent(agentType)` so both Kilocode and Claude Code get TUI mode treatment:
- Lower scrollback lines (2000 vs 20000)
- `shouldFollowOutput()` returns false (prevents auto-scroll)
- Clear scrollback sequences stripped (prevents viewport jumps)

## Test Coverage

Added test: `strips clear scrollback sequence in TUI mode to prevent viewport jumps` in `terminalRegistry.test.ts`

## Summary

The fix ensures TUI-based agents (Kilocode, Claude Code) don't experience viewport jumping caused by `\x1b[3J` sequences. These sequences are intentionally stripped because:
1. TUI apps manage their own viewport/cursor positioning
2. Scrollback is not useful for TUI applications
3. The sequence caused dramatic viewport resets in xterm.js
