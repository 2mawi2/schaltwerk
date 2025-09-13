// Utilities for terminal scroll behavior that must stay deterministic
// and avoid any timing-based logic.

// Minimal xterm-like active buffer surface we rely on
export interface ActiveBufferLike {
  length: number
  // xterm's getLine returns a BufferLine with translateToString(trimRight?: boolean, startCol?: number, endCol?: number)
  getLine: (index: number) => { translateToString: (trimRight?: boolean, start?: number, end?: number) => string } | undefined
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
