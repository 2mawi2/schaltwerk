import { describe, it, expect } from 'vitest'
import { sanitizeSplitSizes, areSizesEqual } from './splitStorage'

describe('sanitizeSplitSizes', () => {
  const defaults: [number, number] = [20, 80]

  it('returns defaults for non-array input', () => {
    expect(sanitizeSplitSizes(null, defaults)).toEqual(defaults)
    expect(sanitizeSplitSizes(undefined, defaults)).toEqual(defaults)
    expect(sanitizeSplitSizes(5, defaults)).toEqual(defaults)
  })

  it('returns defaults for invalid numbers', () => {
    expect(sanitizeSplitSizes(['a', 10], defaults)).toEqual(defaults)
    expect(sanitizeSplitSizes([NaN, 10], defaults)).toEqual(defaults)
    expect(sanitizeSplitSizes([-10, 110], defaults)).toEqual(defaults)
  })

  it('normalizes valid sizes to percentages summing to 100', () => {
    expect(sanitizeSplitSizes([1, 1], defaults)).toEqual([50, 50])
    expect(sanitizeSplitSizes([30, 70], defaults)).toEqual([30, 70])
    expect(sanitizeSplitSizes([200, 100], defaults)).toEqual([66.7, 33.3])
  })

  it('guarantees each pane keeps at least 1%', () => {
    expect(sanitizeSplitSizes([0.01, 9999], defaults)).toEqual([1, 99])
  })
})

describe('areSizesEqual', () => {
  it('detects equal pairs', () => {
    expect(areSizesEqual([10, 90], [10, 90])).toBe(true)
  })

  it('detects different pairs', () => {
    expect(areSizesEqual([10, 90], [11, 89])).toBe(false)
  })
})
