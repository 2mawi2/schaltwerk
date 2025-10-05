import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clampScrollPosition, applyScrollPosition, readScrollState, restoreScrollState, pinBottomDefinitive, type XTermLike } from './termScroll'

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

describe('readScrollState', () => {
  it('detects at bottom when viewportY equals baseY', () => {
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 500 } },
      scrollLines: vi.fn()
    }
    const state = readScrollState(term)
    expect(state.atBottom).toBe(true)
    expect(state.y).toBe(500)
  })

  it('detects scrolled up when viewportY less than baseY', () => {
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 420 } },
      scrollLines: vi.fn()
    }
    const state = readScrollState(term)
    expect(state.atBottom).toBe(false)
    expect(state.y).toBe(420)
  })
})

describe('restoreScrollState', () => {
  it('scrolls to baseY when atBottom is true', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 600, viewportY: 400 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    restoreScrollState(term, { atBottom: true, y: 500 })
    expect(scrollToLine).toHaveBeenCalledWith(600)
  })

  it('scrolls to saved y position when not at bottom', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 600, viewportY: 400 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    restoreScrollState(term, { atBottom: false, y: 450 })
    expect(scrollToLine).toHaveBeenCalledWith(450)
  })

  it('clamps saved position to baseY if it exceeds', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 400 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    restoreScrollState(term, { atBottom: false, y: 700 })
    expect(scrollToLine).toHaveBeenCalledWith(500)
  })

  it('uses scrollLines fallback when scrollToLine not available', () => {
    const scrollLines = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 600, viewportY: 400 } },
      scrollLines
    }
    restoreScrollState(term, { atBottom: false, y: 450 })
    expect(scrollLines).toHaveBeenCalledWith(50)
  })
})

describe('pinBottomDefinitive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    try {
      vi.runOnlyPendingTimers()
    } catch (_error) {
      // Ignore timer flush errors during cleanup
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('scrolls to baseY immediately', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 420 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    pinBottomDefinitive(term)
    expect(scrollToLine).toHaveBeenCalledWith(500)
  })

  it('corrects on next frame if baseY changed', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 420 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    pinBottomDefinitive(term)
    expect(scrollToLine).toHaveBeenCalledWith(500)

    term.buffer.active.baseY = 520
    vi.runAllTimers()

    expect(scrollToLine).toHaveBeenCalledWith(520)
    expect(scrollToLine).toHaveBeenCalledTimes(2)
  })

  it('does not scroll again if baseY unchanged', () => {
    const scrollToLine = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 500 } },
      scrollToLine,
      scrollLines: vi.fn()
    }
    pinBottomDefinitive(term)
    expect(scrollToLine).toHaveBeenCalledWith(500)

    vi.runAllTimers()

    expect(scrollToLine).toHaveBeenCalledTimes(1)
  })

  it('uses scrollLines fallback when scrollToLine not available', () => {
    const scrollLines = vi.fn()
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 420 } },
      scrollLines
    }
    pinBottomDefinitive(term)
    expect(scrollLines).toHaveBeenCalledWith(80)
  })

  it('handles errors gracefully', () => {
    const term: XTermLike = {
      buffer: { active: { baseY: 500, viewportY: 420 } },
      scrollLines: vi.fn(() => { throw new Error('Test error') })
    }
    expect(() => pinBottomDefinitive(term)).not.toThrow()
  })
})
