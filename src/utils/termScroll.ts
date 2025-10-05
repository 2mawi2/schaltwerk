import { logger } from './logger'

export interface ActiveBufferLike {
  length: number
  // xterm's getLine returns a BufferLine with translateToString(trimRight?: boolean, startCol?: number, endCol?: number)
  getLine: (index: number) => { translateToString: (trimRight?: boolean, start?: number, end?: number) => string } | undefined
}

export interface ScrollBufferMetrics {
  baseY?: number
  viewportY?: number
  length?: number
}

export interface ScrollCommandTarget {
  scrollToLine?: (line: number) => void
  scrollLines?: (amount: number) => void
}

/**
 * Counts trailing blank lines at the end of the active buffer.
 * We cap the scan to a small window (e.g. last 200 lines) for performance on huge scrollbacks.
 */
export function countTrailingBlankLines(buf: ActiveBufferLike, maxLookback = 200): number {
  try {
    if (!buf || typeof buf.length !== 'number' || typeof buf.getLine !== 'function') return 0
    const total = buf.length
    if (total <= 0) return 0
    const start = Math.max(0, total - maxLookback)
    let trailing = 0
    for (let i = total - 1; i >= start; i--) {
      const line = buf.getLine(i)
      if (!line) break // be defensive
      const text = line.translateToString(true /* trimRight */)
      // Treat all-whitespace (or empty) as blank
      if (text.trim().length === 0) {
        trailing++
        continue
      }
      break
    }
    return trailing
  } catch {
    return 0
  }
}

export function clampScrollPosition(buffer: ScrollBufferMetrics | undefined, desired: number): number {
  if (!buffer) return Math.max(0, desired)
  const maxLine = typeof buffer.baseY === 'number'
    ? buffer.baseY
    : typeof buffer.length === 'number'
      ? Math.max(0, buffer.length - 1)
      : 0
  if (!Number.isFinite(desired)) return maxLine
  return Math.max(0, Math.min(maxLine, desired))
}

export function applyScrollPosition(target: ScrollCommandTarget, buffer: ScrollBufferMetrics | undefined, desired: number): void {
  const resolved = clampScrollPosition(buffer, desired)
  if (typeof target.scrollToLine === 'function') {
    target.scrollToLine.call(target, resolved)
    return
  }

  if (typeof target.scrollLines === 'function') {
    const current = typeof buffer?.viewportY === 'number' ? buffer.viewportY : 0
    const delta = resolved - current
    if (delta !== 0) {
      target.scrollLines.call(target, delta)
    }
  }
}

export interface XTermLike {
  buffer: {
    active: {
      baseY: number
      viewportY: number
    }
  }
  scrollToLine?: (line: number) => void
  scrollLines: (amount: number) => void
}

export type ScrollState = { atBottom: boolean; y: number }

export function readScrollState(term: XTermLike): ScrollState {
  const buf = term.buffer.active
  const atBottom = buf.viewportY === buf.baseY
  return { atBottom, y: buf.viewportY }
}

export function restoreScrollState(term: XTermLike, state: ScrollState): void {
  const buf = term.buffer.active
  const target = state.atBottom ? buf.baseY : Math.max(0, Math.min(state.y, buf.baseY))
  if (typeof term.scrollToLine === 'function') {
    term.scrollToLine(target)
  } else {
    const delta = target - buf.viewportY
    if (delta !== 0) {
      term.scrollLines(delta)
    }
  }
}

export function pinBottomDefinitive(term: XTermLike): void {
  try {
    const b0 = term.buffer.active.baseY
    if (typeof term.scrollToLine === 'function') {
      term.scrollToLine(b0)
    } else {
      const cur = term.buffer.active.viewportY
      const d = b0 - cur
      if (d !== 0) {
        term.scrollLines(d)
      }
    }
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(cb, 0)
    raf(() => {
      try {
        const b1 = term.buffer.active.baseY
        if (b1 !== b0) {
          if (typeof term.scrollToLine === 'function') {
            term.scrollToLine(b1)
          } else {
            const cur = term.buffer.active.viewportY
            const d = b1 - cur
            if (d !== 0) {
              term.scrollLines(d)
            }
          }
        }
      } catch (error) {
        logger.warn('[termScroll] pinBottomDefinitive RAF correction failed:', error)
      }
    })
  } catch (error) {
    logger.warn('[termScroll] pinBottomDefinitive initial scroll failed:', error)
  }
}
