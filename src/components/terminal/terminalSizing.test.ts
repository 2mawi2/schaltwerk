import { describe, expect, it } from 'vitest'

import { calculateEffectiveColumns, MIN_TERMINAL_COLUMNS } from './terminalSizing'

describe('calculateEffectiveColumns', () => {
  it('never drops below the minimum column count', () => {
    expect(calculateEffectiveColumns(0)).toBe(MIN_TERMINAL_COLUMNS)
    expect(calculateEffectiveColumns(1)).toBe(MIN_TERMINAL_COLUMNS)
    expect(calculateEffectiveColumns(MIN_TERMINAL_COLUMNS)).toBe(MIN_TERMINAL_COLUMNS)
  })

  it('returns the floored column count when space is available', () => {
    expect(calculateEffectiveColumns(6)).toBe(6)
    expect(calculateEffectiveColumns(6.8)).toBe(6)
    expect(calculateEffectiveColumns(120)).toBe(120)
  })
})
