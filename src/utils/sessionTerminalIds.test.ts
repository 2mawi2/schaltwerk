import { describe, it, expect } from 'vitest'
import {
    sanitizeSessionName,
    sessionTerminalTopId,
    sessionTerminalBottomId,
    sessionTerminalBaseId,
} from './sessionTerminalIds'

describe('sessionTerminalIds', () => {
    it('sanitizes session names by replacing unsupported characters', () => {
        expect(sanitizeSessionName('abc-DEF_123')).toBe('abc-DEF_123')
        expect(sanitizeSessionName('weird name!*')).toBe('weird_name__')
    })

    it('includes a deterministic hash suffix to prevent collisions', () => {
        const idWithSlash = sessionTerminalTopId('feature/auth')
        const idWithUnderscore = sessionTerminalTopId('feature_auth')
        expect(idWithSlash).not.toBe(idWithUnderscore)

        const bottomWithSpace = sessionTerminalBottomId('draft session')
        const bottomWithDash = sessionTerminalBottomId('draft-session')
        expect(bottomWithSpace).not.toBe(bottomWithDash)
    })

    it('produces stable ids with expected hash for known inputs', () => {
        expect(sessionTerminalTopId('x y')).toBe('session-x_y-19fe0dc0-top')
        expect(sessionTerminalBottomId('x/y')).toBe('session-x_y-9e66110f-bottom')
        expect(sessionTerminalTopId('demo')).toBe('session-demo-top')
        expect(sessionTerminalBaseId('demo')).toBe('session-demo')
        expect(sanitizeSessionName('😀')).toBe('_')
        expect(sessionTerminalTopId('😀')).toBe('session-_-054db544-top')
        expect(sessionTerminalBottomId('😀')).toBe('session-_-054db544-bottom')
    })
})
