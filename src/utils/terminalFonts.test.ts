import { describe, it, expect } from 'vitest'
import { buildTerminalFontFamily } from './terminalFonts'

describe('buildTerminalFontFamily', () => {
  it('includes custom font first when provided', () => {
    const s = buildTerminalFontFamily('My Custom Mono')
    expect(s.startsWith('"My Custom Mono"')).toBe(true)
  })

  it('contains Nerd Font fallbacks for powerline glyphs', () => {
    const s = buildTerminalFontFamily()
    expect(s).toContain('Symbols Nerd Font')
    expect(s).toContain('MesloLGS NF')
  })

  it('quotes names that contain spaces', () => {
    const s = buildTerminalFontFamily('Space Font')
    expect(s).toContain('"Space Font"')
  })
})

