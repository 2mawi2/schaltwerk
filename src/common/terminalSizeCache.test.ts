import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { recordTerminalSize, getTerminalSize, bestBootstrapSize, clearCacheForTesting } from './terminalSizeCache'

// Mock window for viewport-derived sizing tests
const mockWindow = {
  innerWidth: 1440,
  innerHeight: 900
}

Object.defineProperty(global, 'window', {
  value: mockWindow,
  writable: true
})

describe('terminalSizeCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCacheForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('recordTerminalSize', () => {
    it('records terminal size with timestamp', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      recordTerminalSize('session-test-top', 120, 40)
      const size = getTerminalSize('session-test-top')

      expect(size).toEqual({ cols: 120, rows: 40 })
    })

    it('overwrites previous size for same terminal ID', () => {
      recordTerminalSize('session-test-top', 120, 40)
      recordTerminalSize('session-test-top', 140, 50)

      const size = getTerminalSize('session-test-top')
      expect(size).toEqual({ cols: 140, rows: 50 })
    })

    it('stores different sizes for different terminal IDs', () => {
      recordTerminalSize('session-a-top', 120, 40)
      recordTerminalSize('session-b-top', 140, 50)

      expect(getTerminalSize('session-a-top')).toEqual({ cols: 120, rows: 40 })
      expect(getTerminalSize('session-b-top')).toEqual({ cols: 140, rows: 50 })
    })
  })

  describe('getTerminalSize', () => {
    it('returns null for non-existent terminal ID', () => {
      const size = getTerminalSize('non-existent-terminal')
      expect(size).toBeNull()
    })

    it('returns null for expired entries', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      recordTerminalSize('session-test-top', 120, 40)

      // Advance time beyond TTL (12 hours + 1ms)
      const TTL_MS = 1000 * 60 * 60 * 12
      vi.setSystemTime(now + TTL_MS + 1)

      const size = getTerminalSize('session-test-top')
      expect(size).toBeNull()
    })

    it('returns valid size within TTL period', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      recordTerminalSize('session-test-top', 120, 40)

      // Advance time but stay within TTL
      const TTL_MS = 1000 * 60 * 60 * 12
      vi.setSystemTime(now + TTL_MS - 1000) // 1 second before expiry

      const size = getTerminalSize('session-test-top')
      expect(size).toEqual({ cols: 120, rows: 40 })
    })

    it('cleans up expired entries automatically', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      recordTerminalSize('session-test-top', 120, 40)

      // Advance time beyond TTL
      const TTL_MS = 1000 * 60 * 60 * 12
      vi.setSystemTime(now + TTL_MS + 1)

      // First call should return null and clean up
      expect(getTerminalSize('session-test-top')).toBeNull()

      // Second call should still return null (entry was deleted)
      expect(getTerminalSize('session-test-top')).toBeNull()
    })
  })

  describe('bestBootstrapSize', () => {
    beforeEach(() => {
      clearCacheForTesting()
      vi.setSystemTime(Date.now())
    })

    it('returns exact match when topId exists in cache', () => {
      recordTerminalSize('session-test-top', 120, 40)

      const size = bestBootstrapSize({ topId: 'session-test-top' })

      expect(size).toEqual({
        cols: 122, // 120 + 2 safety margin
        rows: 40
      })
    })

    it('returns orchestrator size when available and no exact match', () => {
      recordTerminalSize('orchestrator-proj-123456-top', 140, 50)

      const size = bestBootstrapSize({
        topId: 'session-new-top',
        projectOrchestratorId: 'orchestrator-proj-123456-top'
      })

      expect(size).toEqual({
        cols: 142, // 140 + 2 safety margin
        rows: 50
      })
    })

    it('prefers exact match over orchestrator', () => {
      recordTerminalSize('session-test-top', 120, 40)
      recordTerminalSize('orchestrator-proj-123456-top', 140, 50)

      const size = bestBootstrapSize({
        topId: 'session-test-top',
        projectOrchestratorId: 'orchestrator-proj-123456-top'
      })

      expect(size).toEqual({
        cols: 122, // 120 + 2 (exact match preferred)
        rows: 40
      })
    })

    it('falls back to any top terminal when no exact/orchestrator match', () => {
      recordTerminalSize('session-other1-top', 130, 45)
      recordTerminalSize('session-other2-bottom-0', 100, 30) // bottom terminal

      const size = bestBootstrapSize({ topId: 'session-new-top' })

      expect(size).toEqual({
        cols: 132, // 130 + 2 (prefers top terminal)
        rows: 45
      })
    })

    it('ignores bottom terminals in fallback search', () => {
      recordTerminalSize('session-other-bottom-0', 100, 30)
      recordTerminalSize('session-other-bottom-1', 110, 35)

      const size = bestBootstrapSize({ topId: 'session-new-top' })

      // Should fall back to viewport-derived size, not use bottom terminals
      expect(size.cols).toBeGreaterThan(110) // Should be viewport-derived
      expect(size.rows).toBeGreaterThan(35)
    })

    it('uses viewport-derived size when no cached sizes available', () => {
      // Ensure cache is completely empty by advancing time
      vi.advanceTimersByTime(1000 * 60 * 60 * 13) // 13 hours

      mockWindow.innerWidth = 1600
      mockWindow.innerHeight = 1000

      const size = bestBootstrapSize({ topId: 'session-new-top' })

      // Expected: (1600 - 360) / 8.5 ≈ 145, (1000 - 280) / 17 ≈ 42
      expect(size.cols).toBeCloseTo(145, -1) // Within 10 of expected
      expect(size.rows).toBeCloseTo(42, -1)
    })

    it('enforces minimum size constraints', () => {
      recordTerminalSize('session-tiny-top', 50, 15) // Below minimums

      const size = bestBootstrapSize({ topId: 'session-tiny-top' })

      expect(size.cols).toBeGreaterThanOrEqual(100) // MIN.cols
      expect(size.rows).toBeGreaterThanOrEqual(28)  // MIN.rows
    })

    it('enforces maximum size constraints', () => {
      recordTerminalSize('session-huge-top', 400, 150) // Above maximums

      const size = bestBootstrapSize({ topId: 'session-huge-top' })

      expect(size.cols).toBeLessThanOrEqual(280) // MAX.cols
      expect(size.rows).toBeLessThanOrEqual(90)  // MAX.rows
    })

    it('adds safety margin to cached sizes', () => {
      recordTerminalSize('session-test-top', 118, 38)

      const size = bestBootstrapSize({ topId: 'session-test-top' })

      expect(size).toEqual({
        cols: 120, // 118 + 2 safety margin
        rows: 38   // rows unchanged
      })
    })

    it('handles window undefined gracefully', () => {
      const originalWindow = global.window
      // @ts-expect-error - Testing undefined window
      delete global.window

      const size = bestBootstrapSize({ topId: 'session-new-top' })

      // Should use fallback dimensions (1440, 900)
      expect(size.cols).toBeGreaterThan(0)
      expect(size.rows).toBeGreaterThan(0)

      global.window = originalWindow
    })

    it('cleans up expired entries during fallback search', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Record some entries
      recordTerminalSize('session-expired-top', 120, 40)
      recordTerminalSize('session-valid-top', 130, 45)

      // Expire the first entry
      const TTL_MS = 1000 * 60 * 60 * 12
      vi.setSystemTime(now + TTL_MS + 1)

      // Record a new valid entry to ensure we have something recent
      recordTerminalSize('session-recent-top', 140, 50)

      const size = bestBootstrapSize({ topId: 'session-new-top' })

      // Should use the recent entry, not the expired one
      expect(size).toEqual({
        cols: 142, // 140 + 2
        rows: 50
      })
    })

    it('ignores orchestrator ID when it does not exist', () => {
      const size = bestBootstrapSize({
        topId: 'session-new-top',
        projectOrchestratorId: 'non-existent-orchestrator'
      })

      // Should fall back to viewport-derived size
      expect(size.cols).toBeGreaterThan(100)
      expect(size.rows).toBeGreaterThan(25)
    })

    it('applies constraints after adding safety margin', () => {
      // Record a size that would exceed max after adding margin
      recordTerminalSize('session-edge-top', 279, 89) // Just under max

      const size = bestBootstrapSize({ topId: 'session-edge-top' })

      expect(size.cols).toBe(280) // 279 + 2 = 281, clamped to 280 max
      expect(size.rows).toBe(89)  // Unchanged, within bounds
    })
  })

  describe('cache TTL behavior', () => {
    it('respects 12-hour TTL period', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      recordTerminalSize('session-ttl-test', 120, 40)

      // Just before expiry - should be valid
      vi.setSystemTime(now + (12 * 60 * 60 * 1000) - 1000)
      expect(getTerminalSize('session-ttl-test')).toEqual({ cols: 120, rows: 40 })

      // Just after expiry - should be null
      vi.setSystemTime(now + (12 * 60 * 60 * 1000) + 1000)
      expect(getTerminalSize('session-ttl-test')).toBeNull()
    })
  })

  describe('size constraints', () => {
    it('defines correct minimum and maximum bounds', () => {
      // Test minimum enforcement in bestBootstrapSize
      recordTerminalSize('session-min-test', 50, 20) // Below mins
      const minSize = bestBootstrapSize({ topId: 'session-min-test' })
      expect(minSize.cols).toBeGreaterThanOrEqual(100)
      expect(minSize.rows).toBeGreaterThanOrEqual(28)

      // Test maximum enforcement in bestBootstrapSize
      recordTerminalSize('session-max-test', 350, 120) // Above maxes
      const maxSize = bestBootstrapSize({ topId: 'session-max-test' })
      expect(maxSize.cols).toBeLessThanOrEqual(280)
      expect(maxSize.rows).toBeLessThanOrEqual(90)
    })
  })
})