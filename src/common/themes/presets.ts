import { withOpacity } from '../colorUtils'
import { theme } from '../theme'
import type { ThemeAccent, ThemeDefinition } from './types'

const buildAccent = (base: string, light: string, dark: string): ThemeAccent => ({
  DEFAULT: base,
  light,
  dark,
  bg: withOpacity(base, 0.1),
  border: withOpacity(base, 0.5),
})

export const darkTheme: ThemeDefinition = {
  id: 'dark',
  name: 'Dark',
  isDark: true,
  colors: {
    background: theme.colors.background,
    text: theme.colors.text,
    border: theme.colors.border,
    accent: theme.colors.accent,
    status: theme.colors.status,
    terminal: {
      background: theme.colors.background.secondary,
      foreground: theme.colors.text.primary,
      cursor: theme.colors.text.primary,
      selection: theme.colors.selection.bg,
      black: theme.colors.background.elevated,
      red: theme.colors.accent.red.DEFAULT,
      green: theme.colors.accent.green.DEFAULT,
      yellow: theme.colors.accent.yellow.DEFAULT,
      blue: theme.colors.accent.blue.DEFAULT,
      magenta: theme.colors.accent.purple.DEFAULT,
      cyan: theme.colors.accent.cyan.DEFAULT,
      white: theme.colors.text.primary,
      brightBlack: theme.colors.background.hover,
      brightRed: theme.colors.accent.red.light,
      brightGreen: theme.colors.accent.green.light,
      brightYellow: theme.colors.accent.yellow.light,
      brightBlue: theme.colors.accent.blue.light,
      brightMagenta: theme.colors.accent.purple.light,
      brightCyan: theme.colors.accent.cyan.light,
      brightWhite: theme.colors.text.primary,
    },
  },
}

const lightAccent = {
  blue: buildAccent('#2563eb', '#3b82f6', '#1d4ed8'),
  green: buildAccent('#16a34a', '#22c55e', '#15803d'),
  amber: buildAccent('#d97706', '#f59e0b', '#b45309'),
  red: buildAccent('#dc2626', '#ef4444', '#b91c1c'),
  violet: buildAccent('#7c3aed', '#8b5cf6', '#6d28d9'),
  purple: buildAccent('#9333ea', '#a855f7', '#7e22ce'),
  magenta: buildAccent('#db2777', '#ec4899', '#be185d'),
  yellow: buildAccent('#ca8a04', '#eab308', '#a16207'),
  cyan: buildAccent('#0891b2', '#06b6d4', '#0e7490'),
  copilot: buildAccent('#BD79CC', '#D9A6E5', '#8F4A9E'),
}

export const lightTheme: ThemeDefinition = {
  id: 'light',
  name: 'Light',
  isDark: false,
  colors: {
    background: {
      primary: '#ffffff',
      secondary: '#f6f8fa',
      tertiary: '#eaeef2',
      elevated: '#ffffff',
      hover: '#eaeef2',
      active: '#d1d9e0',
    },
    text: {
      primary: '#1f2328',
      secondary: '#656d76',
      tertiary: '#8c959f',
      muted: '#8c959f',
      inverse: '#ffffff',
    },
    border: {
      default: '#d1d9e0',
      subtle: '#eaeef2',
      strong: '#d1d9e0',
      focus: lightAccent.blue.DEFAULT,
    },
    accent: lightAccent,
    status: {
      info: '#0891b2',
      success: '#16a34a',
      warning: '#d97706',
      error: '#dc2626',
    },
    terminal: {
      background: '#f6f8fa',
      foreground: '#1f2328',
      cursor: '#1f2328',
      selection: withOpacity(lightAccent.blue.DEFAULT, 0.2),
      black: '#1f2328',
      red: lightAccent.red.DEFAULT,
      green: lightAccent.green.DEFAULT,
      yellow: lightAccent.amber.DEFAULT,
      blue: lightAccent.blue.DEFAULT,
      magenta: lightAccent.purple.DEFAULT,
      cyan: lightAccent.cyan.DEFAULT,
      white: '#eaeef2',
      brightBlack: '#656d76',
      brightRed: lightAccent.red.light,
      brightGreen: lightAccent.green.light,
      brightYellow: lightAccent.amber.light,
      brightBlue: lightAccent.blue.light,
      brightMagenta: lightAccent.purple.light,
      brightCyan: lightAccent.cyan.light,
      brightWhite: '#ffffff',
    },
  },
}
