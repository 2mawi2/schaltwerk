import { describe, it, expect } from 'vitest'
import { getDisplayLabelForSegment, splitShortcutBinding } from './helpers'

describe('getDisplayLabelForSegment', () => {
  it('maps Mod to Command on mac', () => {
    expect(getDisplayLabelForSegment('Mod', 'mac')).toBe('⌘')
  })

  it('maps Mod to Ctrl on non-mac', () => {
    expect(getDisplayLabelForSegment('Mod', 'windows')).toBe('Ctrl')
  })

  it('converts Alt to Option symbol on mac', () => {
    expect(getDisplayLabelForSegment('Alt', 'mac')).toBe('⌥')
  })

  it('converts Shift to shift symbol on all platforms', () => {
    expect(getDisplayLabelForSegment('Shift', 'mac')).toBe('⇧')
    expect(getDisplayLabelForSegment('Shift', 'windows')).toBe('⇧')
  })

  it('keeps literal keys unchanged', () => {
    expect(getDisplayLabelForSegment('Enter', 'mac')).toBe('Enter')
    expect(getDisplayLabelForSegment('K', 'windows')).toBe('K')
  })
})

describe('splitShortcutBinding', () => {
  it('splits by plus sign', () => {
    expect(splitShortcutBinding('Mod+Shift+K')).toEqual(['Mod', 'Shift', 'K'])
  })

  it('returns empty array for empty binding', () => {
    expect(splitShortcutBinding('')).toEqual([])
  })
})
