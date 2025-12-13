import type { XtermTerminal } from '../../../terminal/xterm/XtermTerminal'
import { isTerminalStreaming } from '../../../terminal/registry/terminalRegistry'
import { logger } from '../../../utils/logger'

/**
 * Threshold for "near bottom" snap behavior during focus/resize.
 * VS Code doesn't use threshold-based snapping - they never auto-scroll on output.
 * This is our UX choice: if user is within N lines of bottom during resize/focus,
 * we snap to bottom to maintain "follow" behavior. 5 lines allows for small
 * scroll-backs while still auto-following.
 */
const SCROLL_LOCK_THRESHOLD_LINES = 5

/**
 * Cooldown period after last output before we consider streaming "stopped".
 * Used alongside registry's write-tracking for accurate streaming detection.
 */
const STREAMING_COOLDOWN_MS = 150

/**
 * Encapsulates scroll state save/restore logic.
 * VS Code pattern from markNavigationAddon.ts: save viewportY before operations,
 * restore after. One-shot restore prevents stale state reuse.
 */
class ScrollStateManager {
  private _state: { viewportY: number; baseY: number } | null = null

  save(viewportY: number, baseY: number): void {
    this._state = { viewportY, baseY }
  }

  /**
   * Consume and return saved state. Returns null if no state saved.
   * State is cleared after retrieval (one-shot pattern) to prevent
   * accidentally restoring stale scroll positions on subsequent operations.
   */
  consume(): { viewportY: number; baseY: number } | null {
    const state = this._state
    this._state = null
    return state
  }

  hasSavedState(): boolean {
    return this._state !== null
  }

  clear(): void {
    this._state = null
  }
}

export interface TerminalViewportControllerOptions {
  terminal: XtermTerminal
  terminalId: string
  logger?: (msg: string) => void
}

export class TerminalViewportController {
  private readonly _terminal: XtermTerminal
  /**
   * Terminal ID for registry lookups (streaming detection).
   * Safe as instance property: each controller is bound to exactly one terminal
   * with 1:1 lifecycle (created in Terminal.tsx setupViewportController,
   * disposed on unmount). Not shared state - no need for Jotai.
   */
  private readonly _terminalId: string
  private readonly _logger?: (msg: string) => void
  private _disposed = false
  private _lastOutputTime = 0
  private _outputRaf: number | null = null
  /**
   * Manages scroll position save/restore. Instance-scoped (not Jotai) because
   * each controller manages only its own terminal's scroll state - not shared
   * across components.
   */
  private readonly _scrollStateManager = new ScrollStateManager()

  constructor(options: TerminalViewportControllerOptions) {
    this._terminal = options.terminal
    this._terminalId = options.terminalId
    this._logger = options.logger
  }

  /**
   * Save current scroll position. Call before operations that might change viewport.
   * VS Code pattern: preserves exact viewport position for restoration.
   */
  saveScrollState(): void {
    if (this._disposed) return
    const buf = this._terminal.raw?.buffer?.active
    if (!buf || buf.type === 'alternate') return

    this._scrollStateManager.save(buf.viewportY, buf.baseY)
    this._logger?.(`[TerminalViewportController] Saved scroll state: viewportY=${buf.viewportY}, baseY=${buf.baseY}`)
  }

  /**
   * Restore previously saved scroll position.
   * Uses absolute line coordinates like VS Code's scrollToLine().
   */
  restoreScrollState(): void {
    if (this._disposed) return

    const saved = this._scrollStateManager.consume()
    if (!saved) return

    const raw = this._terminal.raw
    const buf = raw?.buffer?.active
    if (!buf || buf.type === 'alternate') return

    try {
      const bufferGrowth = buf.baseY - saved.baseY
      const targetY = Math.min(saved.viewportY + bufferGrowth, buf.baseY)

      if (targetY !== buf.viewportY) {
        raw.scrollToLine(targetY)
        this._logger?.(`[TerminalViewportController] Restored scroll state: targetY=${targetY}`)
      }
    } catch (e) {
      logger.debug(`[TerminalViewportController] Failed to restore scroll state: ${String(e)}`)
    }
  }

  /**
   * Check if viewport is at the bottom of the buffer.
   */
  isAtBottom(): boolean {
    const buf = this._terminal.raw?.buffer?.active
    if (!buf) return true
    return buf.baseY - buf.viewportY === 0
  }

  /**
   * Check if viewport is near the bottom (within threshold).
   */
  isNearBottom(): boolean {
    const buf = this._terminal.raw?.buffer?.active
    if (!buf) return true
    const distance = buf.baseY - buf.viewportY
    return distance < SCROLL_LOCK_THRESHOLD_LINES
  }

  /**
   * Notify the controller that output was written to the terminal.
   * Only refreshes viewport to sync scrollbar - never auto-scrolls.
   * This follows VS Code's approach: user scroll position is never
   * changed programmatically during streaming.
   */
  onOutput(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return
    this._lastOutputTime = Date.now()

    if (this._outputRaf === null) {
      this._outputRaf = requestAnimationFrame(() => {
        this._outputRaf = null
        this._refreshViewportOnly()
      })
    }
  }

  /**
   * Check if terminal is actively streaming.
   * Uses both time-based check (recent output) and registry check (unparsed data).
   * VS Code pattern: dual-timestamp tracking provides accurate streaming detection.
   *
   * Date.now() is appropriate here (vs performance.now()) because:
   * 1. We only need ~150ms granularity, not sub-millisecond precision
   * 2. It's monotonic enough for our use case (clock adjustments are rare)
   * 3. Matches VS Code's approach in terminalInstance.ts
   */
  private _isStreaming(): boolean {
    const recentOutput = Date.now() - this._lastOutputTime < STREAMING_COOLDOWN_MS
    const hasUnparsedData = isTerminalStreaming(this._terminalId)
    return recentOutput || hasUnparsedData
  }

  /**
   * Call this when the terminal gains focus or is clicked.
   * Snaps to bottom only if user is already close to the bottom.
   */
  onFocusOrClick(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return
    this._refreshAndSnapIfNearBottom('focus')
  }

  /**
   * Called before a resize operation.
   * Saves scroll state so we can restore position after resize completes.
   * VS Code pattern: preserve user's scroll position across layout changes.
   *
   * TUI mode is skipped because TUI applications (vim, htop, less, etc.) use
   * the alternate screen buffer and manage their own viewport. They handle
   * resize via SIGWINCH and redraw themselves - our scroll management would
   * interfere with their internal state.
   */
  beforeResize(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return

    if (!this.isAtBottom()) {
      this.saveScrollState()
    }
  }

  /**
   * Called after a resize operation.
   * Restores scroll position if user had scrolled away, otherwise stays at bottom.
   */
  onResize(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return

    if (this._isStreaming()) {
      this._terminal.refresh()
      this._terminal.forceScrollbarRefresh()
      return
    }

    if (this._scrollStateManager.hasSavedState()) {
      this._terminal.refresh()
      this.restoreScrollState()
      this._terminal.forceScrollbarRefresh()
      return
    }

    this._refreshAndSnapIfNearBottom('resize')
  }

  /**
   * Called when terminal visibility changes.
   * Only snaps to bottom if user was already near bottom; otherwise preserves position.
   */
  onVisibilityChange(isVisible: boolean): void {
    if (this._disposed || !isVisible) return
    if (this._terminal.isTuiMode()) return

    // During streaming, just refresh without position changes
    if (this._isStreaming()) {
      this._terminal.refresh()
      this._terminal.forceScrollbarRefresh()
      return
    }

    this._refreshAndSnapIfNearBottom('visibility')
  }

  /**
   * Notify the controller that the buffer was cleared.
   * Always snaps to bottom since there's nothing to scroll back to.
   */
  onClear(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return
    this._logger?.('[TerminalViewportController] Clear detected')
    this._terminal.refresh()

    const raw = this._terminal.raw
    const buf = raw?.buffer?.active
    if (buf && buf.type !== 'alternate') {
      raw.scrollToBottom()
    }
  }

  /**
   * Refresh viewport and snap to bottom only if within threshold.
   */
  private _refreshAndSnapIfNearBottom(source: string): void {
    try {
      this._terminal.refresh()

      const raw = this._terminal.raw
      const buf = raw?.buffer?.active
      if (!buf || buf.type === 'alternate') return

      const distance = buf.baseY - buf.viewportY
      if (distance < SCROLL_LOCK_THRESHOLD_LINES && distance > 0) {
        this._logger?.(`[TerminalViewportController] Snapping to bottom (source=${source}, distance=${distance})`)
        raw.scrollToBottom()
      }
    } catch (e) {
      logger.error(`[TerminalViewportController] Error during refresh/snap: ${String(e)}`)
    }
  }

  /**
   * Refresh viewport without changing scroll position.
   * Uses _innerRefresh() like VS Code to sync scrollbar without affecting position.
   */
  private _refreshViewportOnly(): void {
    try {
      this._terminal.refresh()

      const buf = this._terminal.raw?.buffer?.active
      if (!buf || buf.type === 'alternate') return

      // Use forceScrollbarRefresh instead of scrollLines(0) to avoid position drift
      // in large buffers. This calls xterm's internal _innerRefresh() which only
      // recalculates scrollbar dimensions without changing viewport position.
      if (buf.baseY > 0) {
        this._terminal.forceScrollbarRefresh()
      }
    } catch (e) {
      logger.error(`[TerminalViewportController] Error during refresh: ${String(e)}`)
    }
  }

  dispose(): void {
    this._disposed = true
    if (this._outputRaf !== null) {
      cancelAnimationFrame(this._outputRaf)
      this._outputRaf = null
    }
  }
}
