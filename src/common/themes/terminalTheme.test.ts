import { describe, expect, it } from 'vitest'
import { buildTerminalTheme } from './terminalTheme'
import { darkTheme, lightTheme } from './presets'

describe('buildTerminalTheme', () => {
  it('builds the dark terminal theme from presets', () => {
    const theme = buildTerminalTheme('dark')
    expect(theme.background).toBe(darkTheme.colors.terminal.background)
    expect(theme.brightCyan).toBe(darkTheme.colors.terminal.brightCyan)
  })

  it('builds the light terminal theme from presets', () => {
    const theme = buildTerminalTheme('light')
    expect(theme.foreground).toBe(lightTheme.colors.terminal.foreground)
    expect(theme.brightWhite).toBe(lightTheme.colors.terminal.brightWhite)
  })
})
