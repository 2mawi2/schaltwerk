import type { XtermTerminal } from '../../../terminal/xterm/XtermTerminal'
import { logger } from '../../../utils/logger'

const SCROLL_LOCK_THRESHOLD_LINES = 5

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

  constructor(options: TerminalViewportControllerOptions) {
    this._terminal = options.terminal
    this._logger = options.logger
  }

  /**
   * Call this when the terminal gains focus or is clicked.
   * It refreshes the viewport and snaps to bottom if the user was already close to the bottom,
   * re-engaging the scroll lock.
   */
  onFocusOrClick(): void {
    if (this._disposed) return
    this._refreshAndSnap('focus')
  }

  /**
   * Call this when the terminal is resized.
   * Resizing naturally fixes many scroll issues, but we enforce the snap here to be sure.
   */
  onResize(): void {
    if (this._disposed) return
    // Resizing already triggers a lot of internal xterm logic.
    // We just ensure we snap if we should.
    // Note: xterm's own resize often forces scroll to bottom if it was at bottom.
    // We add a safeguard here.
    
    // Check if we should snap before blindly forcing it, to avoid fighting the user's scroll
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
      // Force a renderer refresh to fix potential "blank" or "stuck" rendering states
      this._terminal.refresh()

      const raw = this._terminal.raw
      if (!raw?.buffer?.active) return

      const buf = raw.buffer.active
      // Check if we are close enough to the bottom to assume the user wants to be "locked" there.
      // If we are reading history far up, we do NOT want to snap.
      const distance = buf.baseY - buf.viewportY
      if (distance < SCROLL_LOCK_THRESHOLD_LINES) {
        if (distance > 0) {
          this._logger?.(`[TerminalViewportController] Snapping to bottom (source=${source}, distance=${distance})`)
        }
        this._terminal.raw.scrollToBottom()
      }
    } catch (e) {
      const msg = `[TerminalViewportController] Error during refresh/snap: ${String(e)}`
      // Always log errors to global logger to ensure visibility and satisfy architecture requirements
      logger.error(msg)
      // Also invoke the instance logger if provided (e.g. for debug tracing)
      this._logger?.(msg)
    }
  }

  dispose(): void {
    this._disposed = true
  }
}
