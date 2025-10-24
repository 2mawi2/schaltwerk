import { describe, it, expect, beforeEach, vi } from 'vitest'
import { formatLastActivity, formatDurationFromNow } from './time'

describe('formatLastActivity', () => {
    beforeEach(() => {
        // Reset any date mocks
        vi.useRealTimers()
    })

    it('should handle UTC timestamps correctly', () => {
        // Mock current time to a specific UTC time
        const mockNow = new Date('2025-08-09T12:51:20Z')
        vi.useFakeTimers()
        vi.setSystemTime(mockNow)

        // Test case 1: 19 minutes ago (should show "19m")
        const timestamp1 = '2025-08-09T12:32:14.852988Z'
        expect(formatLastActivity(timestamp1)).toBe('19m')

        // Test case 2: ~8.5 days ago (should show "8d")
        const timestamp2 = '2025-07-31T23:03:24.301463Z'
        expect(formatLastActivity(timestamp2)).toBe('8d')

        // Test case 3: 2 hours ago (should show "2h")
        const timestamp3 = '2025-08-09T10:51:20Z'
        expect(formatLastActivity(timestamp3)).toBe('2h')

        // Test case 4: Less than 1 minute ago (should show "now")
        const timestamp4 = '2025-08-09T12:51:00Z'
        expect(formatLastActivity(timestamp4)).toBe('now')

        // Test case 5: Exactly 1 hour ago (should show "1h")
        const timestamp5 = '2025-08-09T11:51:20Z'
        expect(formatLastActivity(timestamp5)).toBe('1h')

        // Test case 6: 23 hours ago (should show "23h")
        const timestamp6 = '2025-08-08T13:51:20Z'
        expect(formatLastActivity(timestamp6)).toBe('23h')

        // Test case 7: 24 hours ago (should show "1d")
        const timestamp7 = '2025-08-08T12:51:20Z'
        expect(formatLastActivity(timestamp7)).toBe('1d')
    })

    it('should handle missing timestamps', () => {
        expect(formatLastActivity(undefined)).toBe('unknown')
        expect(formatLastActivity('')).toBe('unknown')
    })

    it('should handle invalid timestamps', () => {
        expect(formatLastActivity('invalid-date')).toBe('unknown')
    })

    it('should work correctly regardless of local timezone', () => {
        // This test ensures the function works the same way in any timezone
        // by using UTC times consistently
        
        // Set mock time to UTC
        const mockNow = new Date('2025-08-09T12:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(mockNow)

        // Time that's 30 minutes ago in UTC
        const thirtyMinAgo = '2025-08-09T11:30:00Z'
        expect(formatLastActivity(thirtyMinAgo)).toBe('30m')

        // This should be true regardless of the user's local timezone
    })

    it('should handle real-world para timestamps', () => {
        // Test with actual timestamps from para list --json
        const mockNow = new Date('2025-08-09T12:51:20Z')
        vi.useFakeTimers()
        vi.setSystemTime(mockNow)

        // quick_pulsar: created at 12:32 UTC, should show "19m"
        const quickPulsar = '2025-08-09T12:32:14.852988Z'
        expect(formatLastActivity(quickPulsar)).toBe('19m')

        // eager_cosmos: created ~8.5 days ago, should show "8d"
        const eagerCosmos = '2025-07-31T23:03:24.301463Z'
        expect(formatLastActivity(eagerCosmos)).toBe('8d')
    })

    it('should handle edge cases', () => {
        const mockNow = new Date('2025-08-09T12:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(mockNow)

        // Exactly 59 minutes ago (should show "59m" not "1h")
        const fiftyNineMinAgo = '2025-08-09T11:01:00Z'
        expect(formatLastActivity(fiftyNineMinAgo)).toBe('59m')

        // Exactly 60 minutes ago (should show "1h")
        const sixtyMinAgo = '2025-08-09T11:00:00Z'
        expect(formatLastActivity(sixtyMinAgo)).toBe('1h')

        // 119 minutes ago (should show "1h" not "2h")
        const oneHourFiftyNineMinAgo = '2025-08-09T10:01:00Z'
        expect(formatLastActivity(oneHourFiftyNineMinAgo)).toBe('1h')

        // 120 minutes ago (should show "2h")
        const twoHoursAgo = '2025-08-09T10:00:00Z'
        expect(formatLastActivity(twoHoursAgo)).toBe('2h')
    })
})

describe('formatDurationFromNow', () => {
    beforeEach(() => {
        vi.useRealTimers()
    })

    it('handles seconds and minutes correctly', () => {
        const now = new Date('2025-08-09T12:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(now)

        expect(formatDurationFromNow('2025-08-09T11:59:45Z')).toBe('15s ago')
        expect(formatDurationFromNow('2025-08-09T11:40:00Z')).toBe('20m ago')
    })

    it('handles hours, days, months, and years', () => {
        const now = new Date('2025-12-31T12:00:00Z')
        vi.useFakeTimers()
        vi.setSystemTime(now)

        expect(formatDurationFromNow('2025-12-31T10:00:00Z')).toBe('2h ago')
        expect(formatDurationFromNow('2025-12-25T12:00:00Z')).toBe('6d ago')
        expect(formatDurationFromNow('2025-10-31T12:00:00Z')).toBe('2mo ago')
        expect(formatDurationFromNow('2022-12-31T12:00:00Z')).toBe('3y ago')
    })

    it('returns original timestamp on parse failure', () => {
        expect(formatDurationFromNow('not-a-date')).toBe('not-a-date')
    })

    it('handles missing values gracefully', () => {
        expect(formatDurationFromNow(undefined)).toBe('unknown')
        expect(formatDurationFromNow('')).toBe('unknown')
    })
})
