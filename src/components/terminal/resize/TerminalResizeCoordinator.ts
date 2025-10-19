type ResizeSource = 'both' | 'rows' | 'debounce' | 'idle' | 'flush'

export interface TerminalResizeDispatchContext {
  reason: string
  force: boolean
  source: ResizeSource
}

export interface TerminalResizeRequest {
  cols: number
  rows: number
  reason: string
  immediate?: boolean
}

interface IdleScheduler {
  schedule: (callback: () => void) => number
  cancel: (handle: number) => void
}

export interface TerminalResizeCoordinatorOptions {
  /**
   * Delay in milliseconds before applying expensive column updates.
   */
  debounceDelay?: number
  /**
   * Buffer length below which resize requests should bypass debouncing entirely.
   */
  smallBufferThreshold?: number
  /**
   * Returns the current buffer length. Used to decide when to bypass debouncing.
   */
  getBufferLength: () => number
  /**
   * Returns whether the terminal is currently visible.
   */
  isVisible: () => boolean
  /**
   * Applies both columns and rows immediately.
   */
  applyResize: (cols: number, rows: number, context: TerminalResizeDispatchContext) => void
  /**
   * Applies row updates (columns stay unchanged until the debounced resize fires).
   */
  applyRows: (cols: number, rows: number, context: TerminalResizeDispatchContext) => void
  /**
   * Optional idle scheduler overrides (primarily to aid testing).
   */
  scheduleIdle?: IdleScheduler['schedule']
  cancelIdle?: IdleScheduler['cancel']
}

function createIdleScheduler(): IdleScheduler {
  if (typeof window !== 'undefined') {
    const requestIdle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const cancelIdle = (window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback
    if (typeof requestIdle === 'function' && typeof cancelIdle === 'function') {
      return {
        schedule: requestIdle,
        cancel: cancelIdle,
      }
    }
  }
  return {
    schedule: (cb) => window.setTimeout(cb, 60),
    cancel: (handle) => window.clearTimeout(handle),
  }
}

export class TerminalResizeCoordinator {
  private readonly _debounceDelay: number
  private readonly _smallBufferThreshold: number
  private readonly _scheduleIdle: IdleScheduler['schedule']
  private readonly _cancelIdle: IdleScheduler['cancel']

  private _latestCols: number | null = null
  private _latestRows: number | null = null
  private _latestReason: string | null = null

  private _lastAppliedCols: number | null = null
  private _lastAppliedRows: number | null = null

  private _debounceHandle: number | null = null
  private _debounceReason: string | null = null
  private _idleHandle: number | null = null
  private _idleReason: string | null = null
  private _disposed = false

  constructor(private readonly _options: TerminalResizeCoordinatorOptions) {
    this._debounceDelay = _options.debounceDelay ?? 100
    this._smallBufferThreshold = _options.smallBufferThreshold ?? 200
    const idleScheduler = createIdleScheduler()
    this._scheduleIdle = _options.scheduleIdle ?? idleScheduler.schedule
    this._cancelIdle = _options.cancelIdle ?? idleScheduler.cancel
  }

  resize(request: TerminalResizeRequest): void {
    if (this._disposed) return

    const { cols, rows, reason, immediate } = request
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
      return
    }

    if (this._latestCols === cols && this._latestRows === rows && !immediate && !this._debounceHandle && !this._idleHandle) {
      // No dimensional change and nothing queued; bail early.
      return
    }

    this._latestCols = cols
    this._latestRows = rows
    this._latestReason = reason

    if (immediate || this._options.getBufferLength() < this._smallBufferThreshold) {
      this._cancelPending()
      this._dispatchBoth(reason, 'both')
      return
    }

    if (!this._options.isVisible()) {
      this._cancelPending()
      this._idleReason = reason
      this._idleHandle = this._scheduleIdle(() => {
        this._idleHandle = null
        this._dispatchBoth(this._idleReason ?? reason, 'idle')
      })
      return
    }

    this._dispatchRows(reason)
    this._scheduleDebouncedResize(reason)
  }

  flush(reason?: string): void {
    if (this._disposed) return

    const flushReason = reason ?? this._latestReason ?? 'flush'
    const hasPending = this._debounceHandle !== null || this._idleHandle !== null
    this._cancelPending()
    if (hasPending) {
      this._dispatchBoth(flushReason, 'flush')
    }
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._cancelPending()
  }

  private _dispatchRows(reason: string) {
    if (this._latestRows === null) return
    if (this._lastAppliedRows === this._latestRows) return

    const cols = this._lastAppliedCols ?? this._latestCols ?? 0
    this._options.applyRows(cols, this._latestRows, {
      reason,
      force: true,
      source: 'rows',
    })
    this._lastAppliedRows = this._latestRows
  }

  private _dispatchBoth(reason: string, source: ResizeSource) {
    if (this._latestCols === null || this._latestRows === null) return
    if (this._lastAppliedCols === this._latestCols && this._lastAppliedRows === this._latestRows) {
      return
    }

    this._options.applyResize(this._latestCols, this._latestRows, {
      reason,
      force: true,
      source,
    })
    this._lastAppliedCols = this._latestCols
    this._lastAppliedRows = this._latestRows
  }

  private _scheduleDebouncedResize(reason: string) {
    if (this._debounceHandle !== null) {
      window.clearTimeout(this._debounceHandle)
    }
    this._debounceReason = reason
    this._debounceHandle = window.setTimeout(() => {
      this._debounceHandle = null
      this._dispatchBoth(this._debounceReason ?? reason, 'debounce')
    }, this._debounceDelay)
  }

  private _cancelPending() {
    if (this._debounceHandle !== null) {
      window.clearTimeout(this._debounceHandle)
      this._debounceHandle = null
    }
    if (this._idleHandle !== null) {
      this._cancelIdle(this._idleHandle)
      this._idleHandle = null
    }
    this._debounceReason = null
    this._idleReason = null
  }
}
