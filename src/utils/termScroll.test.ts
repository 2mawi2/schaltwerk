import { describe, it, expect, vi } from 'vitest'
import { clampScrollPosition, applyScrollPosition } from './termScroll'

describe('clampScrollPosition', () => {
  it('clamps to baseY when provided', () => {
    const result = clampScrollPosition({ baseY: 480, length: 600 }, 520)
    expect(result).toBe(480)
  })

  it('falls back to length when baseY missing', () => {
    const result = clampScrollPosition({ length: 200 }, -10)
    expect(result).toBe(0)
  })
})

describe('applyScrollPosition', () => {
  it('prefers scrollToLine when available', () => {
    const scrollToLine = vi.fn()
    applyScrollPosition({ scrollToLine }, { baseY: 200, viewportY: 10 }, 150)
    expect(scrollToLine).toHaveBeenCalledWith(150)
  })

  it('falls back to scrollLines delta', () => {
    const scrollLines = vi.fn()
    applyScrollPosition({ scrollLines }, { baseY: 500, viewportY: 420 }, 480)
    expect(scrollLines).toHaveBeenCalledWith(60)
  })

  it('does nothing when no scroll methods provided', () => {
    expect(() => applyScrollPosition({}, { baseY: 100 }, 50)).not.toThrow()
  })
})
