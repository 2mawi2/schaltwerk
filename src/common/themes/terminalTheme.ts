import type { ITheme } from '@xterm/xterm'
import { ResolvedTheme } from './types'
import { darkTheme, lightTheme } from './presets'

export function buildTerminalTheme(themeId: ResolvedTheme): ITheme {
  const colors = themeId === 'dark' ? darkTheme.colors.terminal : lightTheme.colors.terminal
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.cursor,
    cursorAccent: colors.background,
    selectionBackground: colors.selection,
    black: colors.black,
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    blue: colors.blue,
    magenta: colors.magenta,
    cyan: colors.cyan,
    white: colors.white,
    brightBlack: colors.brightBlack,
    brightRed: colors.brightRed,
    brightGreen: colors.brightGreen,
    brightYellow: colors.brightYellow,
    brightBlue: colors.brightBlue,
    brightMagenta: colors.brightMagenta,
    brightCyan: colors.brightCyan,
    brightWhite: colors.brightWhite,
  }
}
