import type { Terminal } from 'ghostty-web'

type SearchDirection = 'next' | 'previous'

export interface TerminalSearchMatch {
  row: number
  col: number
  length: number
}

function getViewportY(terminal: Terminal): number {
  const getter = (terminal as unknown as { getViewportY?: () => number }).getViewportY
  if (typeof getter === 'function') {
    return Math.max(0, Math.floor(getter.call(terminal)))
  }
  return Math.max(0, Math.floor((terminal as unknown as { viewportY?: number }).viewportY ?? 0))
}

function getScrollbackLength(terminal: Terminal): number {
  const getter = (terminal as unknown as { getScrollbackLength?: () => number }).getScrollbackLength
  if (typeof getter === 'function') {
    return Math.max(0, Math.floor(getter.call(terminal)))
  }

  const bufferLength = (terminal as unknown as { buffer?: { active?: { length?: number } } }).buffer?.active
    ?.length
  if (typeof bufferLength === 'number') {
    return Math.max(0, Math.floor(bufferLength - terminal.rows))
  }
  return 0
}

function getBufferLineText(terminal: Terminal, row: number): string {
  const line = terminal.buffer.active.getLine(row)
  if (!line) return ''
  return line.translateToString(true)
}

function findNextMatchInBuffer(
  terminal: Terminal,
  query: string,
  start: { row: number; col: number },
): TerminalSearchMatch | null {
  const buffer = terminal.buffer.active
  const q = query.toLowerCase()
  const bufferLength = buffer.length

  const scan = (rowFrom: number, rowTo: number) => {
    for (let row = rowFrom; row <= rowTo; row += 1) {
      const text = getBufferLineText(terminal, row)
      if (!text) continue
      const lower = text.toLowerCase()
      const fromIndex = row === start.row ? Math.max(0, start.col) : 0
      const idx = lower.indexOf(q, fromIndex)
      if (idx !== -1) {
        return { row, col: idx, length: query.length }
      }
    }
    return null
  }

  const firstPass = scan(start.row, bufferLength - 1)
  if (firstPass) return firstPass
  if (start.row <= 0) return null
  return scan(0, Math.min(bufferLength - 1, start.row))
}

function findPreviousMatchInBuffer(
  terminal: Terminal,
  query: string,
  start: { row: number; col: number },
): TerminalSearchMatch | null {
  const buffer = terminal.buffer.active
  const q = query.toLowerCase()
  const bufferLength = buffer.length

  const scan = (rowFrom: number, rowTo: number) => {
    for (let row = rowFrom; row >= rowTo; row -= 1) {
      const text = getBufferLineText(terminal, row)
      if (!text) continue
      const lower = text.toLowerCase()
      const fromIndex = row === start.row ? Math.min(start.col, lower.length) : lower.length
      const idx = lower.lastIndexOf(q, fromIndex)
      if (idx !== -1) {
        return { row, col: idx, length: query.length }
      }
    }
    return null
  }

  const firstPass = scan(start.row, 0)
  if (firstPass) return firstPass
  if (start.row >= bufferLength - 1) return null
  return scan(bufferLength - 1, Math.max(0, start.row))
}

function applyMatch(terminal: Terminal, match: TerminalSearchMatch): void {
  const scrollbackLength = getScrollbackLength(terminal)
  const rows = terminal.rows
  const currentViewportY = getViewportY(terminal)
  const visibleRow = match.row - scrollbackLength + currentViewportY

  let viewportY = currentViewportY
  if (visibleRow < 0 || visibleRow > rows - 1) {
    const desiredRow = Math.min(2, rows - 1)
    viewportY = Math.max(0, Math.min(scrollbackLength, scrollbackLength + desiredRow - match.row))
    terminal.scrollToLine(viewportY)
  }

  const viewportRow = Math.max(0, Math.min(rows - 1, match.row - scrollbackLength + viewportY))
  terminal.select(match.col, viewportRow, match.length)
}

export class TerminalSearch {
  private lastQuery: string | null = null
  private lastMatch: TerminalSearchMatch | null = null

  constructor(private readonly terminal: Terminal) {}

  reset(): void {
    this.lastQuery = null
    this.lastMatch = null
  }

  findNext(query: string): boolean {
    return this.find(query, 'next')
  }

  findPrevious(query: string): boolean {
    return this.find(query, 'previous')
  }

  private find(query: string, direction: SearchDirection): boolean {
    const trimmed = query.trim()
    if (!trimmed) {
      return false
    }

    if (this.lastQuery !== trimmed) {
      this.lastQuery = trimmed
      this.lastMatch = null
    }

    const bufferLength = this.terminal.buffer.active.length
    if (bufferLength <= 0) {
      return false
    }

    const scrollbackLength = getScrollbackLength(this.terminal)
    const viewportY = getViewportY(this.terminal)
    const topAbsRow = Math.max(0, Math.min(bufferLength - 1, scrollbackLength - viewportY))

    const start =
      this.lastMatch && this.lastQuery === trimmed
        ? direction === 'next'
          ? { row: this.lastMatch.row, col: this.lastMatch.col + this.lastMatch.length }
          : { row: this.lastMatch.row, col: this.lastMatch.col - 1 }
        : direction === 'next'
          ? { row: topAbsRow, col: 0 }
          : { row: topAbsRow, col: Number.POSITIVE_INFINITY }

    const match =
      direction === 'next'
        ? findNextMatchInBuffer(this.terminal, trimmed, start)
        : findPreviousMatchInBuffer(this.terminal, trimmed, start)

    if (!match) {
      return false
    }

    this.lastMatch = match
    applyMatch(this.terminal, match)
    return true
  }
}

