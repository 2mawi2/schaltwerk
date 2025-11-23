import { describe, it, expect } from 'vitest'
import { areSizesEqual, sanitizeSplitSizes } from './splitStorage'

describe('splitStorage', () => {
  describe('areSizesEqual', () => {
    it('returns false for null or undefined inputs without throwing', () => {
      expect(() => areSizesEqual(null, [20, 80])).not.toThrow()
      expect(areSizesEqual(null, [20, 80])).toBe(false)
      expect(areSizesEqual(undefined, [20, 80])).toBe(false)
    })

    it('returns false for non-array inputs', () => {
      expect(areSizesEqual(42, [20, 80])).toBe(false)
      expect(areSizesEqual([20, 80], 'not-an-array')).toBe(false)
    })

    it('returns false when arrays contain non-numeric values', () => {
      expect(areSizesEqual(['a', 'b'], [20, 80])).toBe(false)
      expect(areSizesEqual([NaN, 80], [20, 80])).toBe(false)
    })

    it('compares numeric size arrays correctly', () => {
      expect(areSizesEqual([20, 80], [20, 80])).toBe(true)
      expect(areSizesEqual([20, 80], [21, 79])).toBe(false)
    })
  })

  describe('sanitizeSplitSizes', () => {
    it('falls back to defaults when input is null', () => {
      expect(sanitizeSplitSizes(null, [30, 70])).toEqual([30, 70])
    })
  })
})

