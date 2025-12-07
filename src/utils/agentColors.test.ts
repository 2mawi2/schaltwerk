import { describe, it, expect } from 'vitest'
import { getAgentColorKey } from './agentColors'

describe('agentColors', () => {
    describe('getAgentColorKey', () => {
        it('returns blue for claude', () => {
            expect(getAgentColorKey('claude')).toBe('blue')
        })

        it('returns green for opencode', () => {
            expect(getAgentColorKey('opencode')).toBe('green')
        })

        it('returns orange for gemini', () => {
            expect(getAgentColorKey('gemini')).toBe('orange')
        })

        it('returns violet for droid', () => {
            expect(getAgentColorKey('droid')).toBe('violet')
        })

        it('returns red for codex', () => {
            expect(getAgentColorKey('codex')).toBe('red')
        })

        it('returns yellow for amp', () => {
            expect(getAgentColorKey('amp')).toBe('yellow')
        })

        it('returns yellow for kilocode', () => {
            expect(getAgentColorKey('kilocode')).toBe('yellow')
        })

        it('returns red for unknown agents', () => {
            expect(getAgentColorKey('unknown')).toBe('red')
            expect(getAgentColorKey('foo')).toBe('red')
        })
    })
})
