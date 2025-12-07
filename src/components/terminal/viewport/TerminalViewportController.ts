import type { XtermTerminal } from '../../../terminal/xterm/XtermTerminal'
import { logger } from '../../../utils/logger'

const SCROLL_LOCK_THRESHOLD_LINES = 5
const STREAMING_COOLDOWN_MS = 150
const SCROLL_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('SCROLL_DEBUG') === '1'

export interface TerminalViewportControllerOptions {
  /**
   * The terminal instance to control.
   */
  terminal: XtermTerminal
  /**
   * Optional callback to log events (for debugging).
   */
  logger?: (msg: string) => void
}

export class TerminalViewportController {
  private readonly _terminal: XtermTerminal
  private readonly _logger?: (msg: string) => void
  private _disposed = false
  private _lastOutputTime = 0
  private _userScrolledAway = false
  private _lastKnownViewportY: number | null = null
  private _isResizing = false

  constructor(options: TerminalViewportControllerOptions) {
    this._terminal = options.terminal
    this._logger = options.logger
    this._setupScrollTracking()
  }

  private _logScrollState(source: string): void {
    if (!SCROLL_DEBUG) return
    try {
      const raw = this._terminal.raw
      const buf = raw?.buffer?.active
      if (!buf) return

      const viewportY = buf.viewportY
      const distance = buf.baseY - viewportY

      logger.info(`[Scroll:${source}] viewportY=${viewportY} dist=${distance} userAway=${this._userScrolledAway}`)
    } catch {
      // ignore
    }
  }

  private _setupScrollTracking(): void {
    const raw = this._terminal.raw
    if (!raw) return

    raw.onScroll(() => {
      if (this._disposed || this._isResizing) return
      const buf = raw.buffer?.active
      if (!buf) return

      const distance = buf.baseY - buf.viewportY
      const isAtBottom = distance === 0

      if (this._lastKnownViewportY !== null) {
        const scrolledUp = buf.viewportY < this._lastKnownViewportY
        if (scrolledUp && !isAtBottom) {
          this._userScrolledAway = true
        }
      }

      if (isAtBottom) {
        this._userScrolledAway = false
      }

      this._logScrollState('scroll')
      this._lastKnownViewportY = buf.viewportY
    })
  }

  /**
   * Notify the controller that output was written to the terminal.
   * This helps track streaming activity to avoid scroll jumps during active output.
   */
  onOutput(): void {
    if (this._disposed) return
    this._lastOutputTime = Date.now()
  }

  /**
   * Check if the terminal is actively receiving output (streaming).
   */
  private _isStreaming(): boolean {
    return Date.now() - this._lastOutputTime < STREAMING_COOLDOWN_MS
  }

  /**
   * Call this when the terminal gains focus or is clicked.
   * It refreshes the viewport and snaps to bottom if the user was already close to the bottom,
   * re-engaging the scroll lock.
   */
  onFocusOrClick(): void {
    if (this._disposed) return
    this._userScrolledAway = false
    this._refreshAndSnap('focus')
  }

  /**
   * Notify the controller that a resize is about to happen.
   * This prevents scroll events triggered by reflow from being interpreted as user interaction.
   */
  beforeResize(): void {
    this._isResizing = true
  }

  /**
   * Call this when the terminal is resized.
   * Resizing naturally fixes many scroll issues, but we enforce the snap here to be sure.
   */
  onResize(): void {
    if (this._disposed) return

    this._isResizing = false
    this._lastKnownViewportY = null

    if (this._isStreaming() && this._userScrolledAway) {
      this._logger?.(`[TerminalViewportController] Skipping snap during streaming (user scrolled away)`)
      this._terminal.refresh()
      return
    }

    this._refreshAndSnap('resize')
  }

  /**
   * Call this when the terminal becomes visible after being hidden.
   */
  onVisibilityChange(isVisible: boolean): void {
    if (this._disposed || !isVisible) return
    this._refreshAndSnap('visibility')
  }

  /**
   * Force a refresh and conditional snap to bottom.
   */
  private _refreshAndSnap(source: string): void {
    try {
      this._terminal.refresh()

      const raw = this._terminal.raw
      if (!raw?.buffer?.active) return

      const buf = raw.buffer.active

      // TUI apps (vim, htop, Claude CLI) use the alternate buffer and control the viewport themselves.
      // Calling scrollToBottom() would fight with their rendering and cause bottom-line flickering.
      if (buf.type === 'alternate') {
        return
      }

      const distance = buf.baseY - buf.viewportY

      if (this._isStreaming() && this._userScrolledAway && source === 'resize') {
        this._logger?.(`[TerminalViewportController] Skip snap: streaming + user scrolled away (source=${source}, distance=${distance})`)
        return
      }

      if (distance < SCROLL_LOCK_THRESHOLD_LINES) {
        if (distance > 0) {
          this._logger?.(`[TerminalViewportController] Snapping to bottom (source=${source}, distance=${distance})`)
        }
        this._terminal.raw.scrollToBottom()
        this._userScrolledAway = false
      }
    } catch (e) {
      const msg = `[TerminalViewportController] Error during refresh/snap: ${String(e)}`
      logger.error(msg)
      this._logger?.(msg)
    }
  }

  dispose(): void {
    this._disposed = true
  }
}
