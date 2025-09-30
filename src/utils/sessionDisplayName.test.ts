import { describe, expect, it } from 'vitest'
import { getSessionDisplayName } from './sessionDisplayName'

describe('getSessionDisplayName', () => {
    it('returns the display name when present', () => {
        expect(getSessionDisplayName({ session_id: 'abc', display_name: 'Feature X' })).toBe('Feature X')
    })

    it('falls back to the session id when display name missing', () => {
        expect(getSessionDisplayName({ session_id: 'fallback', display_name: undefined })).toBe('fallback')
    })

    it('allows null display names', () => {
        expect(getSessionDisplayName({ session_id: 'null-case', display_name: null })).toBe('null-case')
    })
})
