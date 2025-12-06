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
  private _lastKnownBaseY: number | null = null
  private _lastKnownBufferLength: number | null = null

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
      const baseY = buf.baseY
      const bufferLength = buf.length
      const distance = baseY - viewportY

      const viewportDelta = this._lastKnownViewportY !== null ? viewportY - this._lastKnownViewportY : 0
      const baseDelta = this._lastKnownBaseY !== null ? baseY - this._lastKnownBaseY : 0
      const lengthDelta = this._lastKnownBufferLength !== null ? bufferLength - this._lastKnownBufferLength : 0

      logger.info(`[Scroll:${source}] viewportY=${viewportY}(${viewportDelta >= 0 ? '+' : ''}${viewportDelta}) baseY=${baseY}(${baseDelta >= 0 ? '+' : ''}${baseDelta}) bufLen=${bufferLength}(${lengthDelta >= 0 ? '+' : ''}${lengthDelta}) dist=${distance} userAway=${this._userScrolledAway}`)

      this._lastKnownBaseY = baseY
      this._lastKnownBufferLength = bufferLength
    } catch {
      // ignore
    }
  }

  private _setupScrollTracking(): void {
    const raw = this._terminal.raw
    if (!raw) return

    raw.onScroll(() => {
      if (this._disposed) return
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
   * Call this when the terminal is resized.
   * Resizing naturally fixes many scroll issues, but we enforce the snap here to be sure.
   */
  onResize(): void {
    if (this._disposed) return

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
