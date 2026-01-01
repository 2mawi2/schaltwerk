import { describe, expect, it, vi } from 'vitest'

import { TerminalSearch } from './terminalSearch'

type MockLine = { translateToString: (trimRight?: boolean) => string }

function buildMockTerminal(options: {
  rows: number
  cols: number
  scrollbackLength: number
  viewportY: number
  lines: string[]
}) {
  let viewportY = options.viewportY
  const getLine = (y: number): MockLine | undefined => {
    const text = options.lines[y]
    if (typeof text !== 'string') return undefined
    return { translateToString: () => text }
  }

  return {
    rows: options.rows,
    cols: options.cols,
    buffer: {
      active: {
        type: 'normal',
        length: options.lines.length,
        getLine,
      },
    },
    getScrollbackLength: () => options.scrollbackLength,
    getViewportY: () => viewportY,
    scrollToLine: vi.fn((next: number) => {
      viewportY = next
    }),
    select: vi.fn(),
  }
}

describe('TerminalSearch', () => {
  it('finds the next match and selects it without scrolling when already visible', () => {
    const terminal = buildMockTerminal({
      rows: 3,
      cols: 80,
      scrollbackLength: 2,
      viewportY: 0,
      lines: ['old 1', 'old 2', 'hello', 'world', 'hello world'],
    })

    const search = new TerminalSearch(terminal as any)
    expect(search.findNext('world')).toBe(true)

    expect(terminal.scrollToLine).not.toHaveBeenCalled()
    expect(terminal.select).toHaveBeenCalledWith(0, 1, 5)
  })

  it('scrolls to reveal matches that are currently in scrollback', () => {
    const terminal = buildMockTerminal({
      rows: 5,
      cols: 80,
      scrollbackLength: 10,
      viewportY: 0,
      lines: Array.from({ length: 15 }, (_, idx) => `line ${idx}`),
    })

    // Put a match in scrollback (row 8)
    terminal.buffer.active.getLine = (y: number) => {
      if (y === 8) return { translateToString: () => 'needle here' }
      return { translateToString: () => `line ${y}` }
    }

    const search = new TerminalSearch(terminal as any)
    expect(search.findNext('needle')).toBe(true)

    // viewportY = scrollbackLength + desiredRow(2) - matchRow(8) = 10 + 2 - 8 = 4
    expect(terminal.scrollToLine).toHaveBeenCalledWith(4)
    // With viewportY=4 the match is rendered on viewportRow: 8 - 10 + 4 = 2
    expect(terminal.select).toHaveBeenCalledWith(0, 2, 6)
  })

  it('wraps around when searching forward', () => {
    const terminal = buildMockTerminal({
      rows: 3,
      cols: 80,
      scrollbackLength: 0,
      viewportY: 0,
      lines: ['foo', 'bar', 'foo'],
    })

    const search = new TerminalSearch(terminal as any)
    expect(search.findNext('foo')).toBe(true)
    expect(terminal.select).toHaveBeenLastCalledWith(0, 0, 3)

    expect(search.findNext('foo')).toBe(true)
    expect(terminal.select).toHaveBeenLastCalledWith(0, 2, 3)

    // Wrap back to the first occurrence
    expect(search.findNext('foo')).toBe(true)
    expect(terminal.select).toHaveBeenLastCalledWith(0, 0, 3)
  })

  it('searches case-insensitively', () => {
    const terminal = buildMockTerminal({
      rows: 2,
      cols: 80,
      scrollbackLength: 0,
      viewportY: 0,
      lines: ['Hello', 'world'],
    })

    const search = new TerminalSearch(terminal as any)
    expect(search.findNext('hello')).toBe(true)
    expect(terminal.select).toHaveBeenCalledWith(0, 0, 5)
  })
})

