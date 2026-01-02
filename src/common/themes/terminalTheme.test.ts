import { describe, expect, it } from 'vitest'
import { buildTerminalTheme } from './terminalTheme'
import { darkTheme, lightTheme, tokyonightTheme } from './presets'

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

  it('builds the tokyonight terminal theme from presets', () => {
    const theme = buildTerminalTheme('tokyonight')
    expect(theme.background).toBe(tokyonightTheme.colors.terminal.background)
    expect(theme.foreground).toBe(tokyonightTheme.colors.terminal.foreground)
    expect(theme.blue).toBe(tokyonightTheme.colors.terminal.blue)
  })
})
