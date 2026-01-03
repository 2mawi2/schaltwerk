import { describe, expect, it } from 'vitest'
import { buildTerminalTheme } from './terminalTheme'
import { ayuTheme, darkTheme, lightTheme, tokyonightTheme, catppuccinTheme, catppuccinMacchiatoTheme, everforestTheme } from './presets'

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

  it('builds the catppuccin terminal theme from presets', () => {
    const theme = buildTerminalTheme('catppuccin')
    expect(theme.background).toBe(catppuccinTheme.colors.terminal.background)
    expect(theme.foreground).toBe(catppuccinTheme.colors.terminal.foreground)
    expect(theme.blue).toBe(catppuccinTheme.colors.terminal.blue)
  })

  it('builds the catppuccin-macchiato terminal theme from presets', () => {
    const theme = buildTerminalTheme('catppuccin-macchiato')
    expect(theme.background).toBe(catppuccinMacchiatoTheme.colors.terminal.background)
    expect(theme.foreground).toBe(catppuccinMacchiatoTheme.colors.terminal.foreground)
    expect(theme.blue).toBe(catppuccinMacchiatoTheme.colors.terminal.blue)
  })

  it('builds the everforest terminal theme from presets', () => {
    const theme = buildTerminalTheme('everforest')
    expect(theme.background).toBe(everforestTheme.colors.terminal.background)
    expect(theme.foreground).toBe(everforestTheme.colors.terminal.foreground)
    expect(theme.green).toBe(everforestTheme.colors.terminal.green)
  })

  it('builds the ayu terminal theme from presets', () => {
    const theme = buildTerminalTheme('ayu')
    expect(theme.background).toBe(ayuTheme.colors.terminal.background)
    expect(theme.foreground).toBe(ayuTheme.colors.terminal.foreground)
    expect(theme.blue).toBe(ayuTheme.colors.terminal.blue)
  })
})
