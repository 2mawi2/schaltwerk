import { describe, it, expect } from 'vitest'
import { countTrailingBlankLines } from './termScroll'

function makeBuffer(lines: string[]) {
  return {
    length: lines.length,
    getLine: (idx: number) =>
      idx >= 0 && idx < lines.length
        ? { translateToString: () => lines[idx] }
        : undefined,
  }
}

describe('termScroll helpers', () => {
  it('counts zero when no trailing blanks', () => {
    const buf = makeBuffer(['a', 'b', 'c'])
    expect(countTrailingBlankLines(buf)).toBe(0)
  })

  it('counts contiguous trailing blanks', () => {
    const buf = makeBuffer(['out1', 'out2', '', '   '])
    expect(countTrailingBlankLines(buf)).toBe(2)
  })

  it('ignores interior blanks but stops at last non-empty', () => {
    const buf = makeBuffer(['', 'x', '', 'y', '   '])
    expect(countTrailingBlankLines(buf)).toBe(1)
  })

  it('returns 0 for completely blank buffers (safe no-op)', () => {
    const buf = makeBuffer(['', '   ', ''])
    expect(countTrailingBlankLines(buf)).toBe(3) // All are blank -> trailing is all
  })
})

