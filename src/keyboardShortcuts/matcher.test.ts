import { describe, it, expect } from 'vitest'
import { matchesShortcut, normalizeShortcut } from './matcher'

const createEvent = (key: string, options: Partial<KeyboardEvent> = {}) => {
  return new KeyboardEvent('keydown', {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
    bubbles: true,
    cancelable: true,
  })
}

describe('keyboard shortcut matcher', () => {
  it('normalizes shortcut casing and whitespace', () => {
    expect(normalizeShortcut('  mod + Shift + d ')).toEqual('Mod+Shift+D')
  })

  it('matches primary modifier on mac using meta key', () => {
    const shortcut = 'Mod+D'
    const event = createEvent('d', { metaKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'mac' })).toBe(true)
  })

  it('matches primary modifier on windows using ctrl key', () => {
    const shortcut = 'Mod+D'
    const event = createEvent('d', { ctrlKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'windows' })).toBe(true)
  })

  it('requires shift modifier when specified', () => {
    const shortcut = 'Mod+Shift+S'
    const eventWithoutShift = createEvent('s', { metaKey: true })
    const eventWithShift = createEvent('s', { metaKey: true, shiftKey: true })

    expect(matchesShortcut(eventWithoutShift, shortcut, { platform: 'mac' })).toBe(false)
    expect(matchesShortcut(eventWithShift, shortcut, { platform: 'mac' })).toBe(true)
  })

  it('normalizes key casing when matching', () => {
    const shortcut = 'Mod+G'
    const event = createEvent('G', { metaKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'mac' })).toBe(true)
  })

  it('does not match when extra modifiers are pressed unless allowed', () => {
    const shortcut = 'Mod+G'
    const event = createEvent('g', { metaKey: true, shiftKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'mac' })).toBe(false)
  })

  it('matches optional shift modifier when defined with bracket syntax', () => {
    const shortcut = 'Mod+[Shift]+='
    const eventWithoutShift = createEvent('=', { metaKey: true })
    const eventWithShift = createEvent('=', { metaKey: true, shiftKey: true })

    expect(matchesShortcut(eventWithoutShift, shortcut, { platform: 'mac' })).toBe(true)
    expect(matchesShortcut(eventWithShift, shortcut, { platform: 'mac' })).toBe(true)
  })

  it('handles special characters like slash', () => {
    const shortcut = 'Mod+/'
    const event = createEvent('/', { metaKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'mac' })).toBe(true)
  })

  it('treats plus as equal without shift requirement', () => {
    const shortcut = 'Mod+='
    const event = createEvent('=', { metaKey: true })
    expect(matchesShortcut(event, shortcut, { platform: 'mac' })).toBe(true)
  })
})
