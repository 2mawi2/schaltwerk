import { describe, expect, it } from 'vitest'
import { formatRgbTuple, hexToRgb, withOpacity } from './colorUtils'

describe('color utilities', () => {
  it('converts hex to rgb array', () => {
    expect(hexToRgb('#3b82f6')).toEqual([59, 130, 246])
  })

  it('returns hex string with provided opacity encoded', () => {
    expect(withOpacity('#0b1220', 0.75)).toBe('#0b1220bf')
  })

  it('formats RGB tuples for CSS variables', () => {
    expect(formatRgbTuple([2, 6, 23])).toBe('2 6 23')
  })
})
