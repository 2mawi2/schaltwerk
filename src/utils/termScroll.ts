// Utilities for terminal scroll behavior that must stay deterministic
// and avoid any timing-based logic.

/**
 * Count trailing blank lines at the end of an xterm buffer.
 * A line is considered blank if its translated string trims to empty.
 * If API access fails, returns 0 (safe no-op).
 */
export function countTrailingBlankLines(buffer: {
  length: number
  getLine: (idx: number) => { translateToString: (trimRight?: boolean) => string } | undefined
}): number {
  try {
    let i = buffer.length - 1
    let trailing = 0
    while (i >= 0) {
      const line = buffer.getLine(i)
      if (!line) break
      const text = line.translateToString(true)
      if (text.trim().length === 0) {
        trailing++
        i--
        continue
      }
      break
    }
    return Math.max(0, trailing)
  } catch {
    return 0
  }
}

