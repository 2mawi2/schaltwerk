import type { XtermTerminal } from '../../../terminal/xterm/XtermTerminal'
import { logger } from '../../../utils/logger'

const SCROLL_LOCK_THRESHOLD_LINES = 5
const STREAMING_COOLDOWN_MS = 150

export interface TerminalViewportControllerOptions {
  terminal: XtermTerminal
  logger?: (msg: string) => void
}

export class TerminalViewportController {
  private readonly _terminal: XtermTerminal
  private readonly _logger?: (msg: string) => void
  private _disposed = false
  private _lastOutputTime = 0
  private _outputRaf: number | null = null

  constructor(options: TerminalViewportControllerOptions) {
    this._terminal = options.terminal
    this._logger = options.logger
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

  private _isStreaming(): boolean {
    return Date.now() - this._lastOutputTime < STREAMING_COOLDOWN_MS
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

  beforeResize(): void {
    // No-op - kept for API compatibility
  }

  onResize(): void {
    if (this._disposed) return
    if (this._terminal.isTuiMode()) return

    if (this._isStreaming()) {
      this._terminal.refresh()
      return
    }

    this._refreshAndSnapIfNearBottom('resize')
  }

  onVisibilityChange(isVisible: boolean): void {
    if (this._disposed || !isVisible) return
    if (this._terminal.isTuiMode()) return
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
   */
  private _refreshViewportOnly(): void {
    try {
      this._terminal.refresh()

      const raw = this._terminal.raw
      const buf = raw?.buffer?.active
      if (!buf || buf.type === 'alternate') return

      if (buf.baseY > 0) {
        raw.scrollLines(0)
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
