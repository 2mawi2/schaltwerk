import { describe, it, expect, beforeEach, vi } from 'vitest'
import { formatDurationFromNow } from './time'

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
