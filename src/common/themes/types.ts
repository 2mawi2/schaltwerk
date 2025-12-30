export type ThemeId = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

export interface ThemeAccent {
  DEFAULT: string
  light: string
  dark: string
  bg: string
  border: string
}

export interface ThemeColors {
  background: {
    primary: string
    secondary: string
    tertiary: string
    elevated: string
    hover: string
    active: string
  }
  text: {
    primary: string
    secondary: string
    tertiary: string
    muted: string
    inverse: string
  }
  border: {
    default: string
    subtle: string
    strong: string
    focus: string
  }
  accent: {
    blue: ThemeAccent
    green: ThemeAccent
    amber: ThemeAccent
    red: ThemeAccent
    violet: ThemeAccent
    purple: ThemeAccent
    magenta: ThemeAccent
    yellow: ThemeAccent
    cyan: ThemeAccent
    copilot: ThemeAccent
  }
  status: {
    info: string
    success: string
    warning: string
    error: string
  }
  terminal: {
    background: string
    foreground: string
    cursor: string
    selection: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
}

export interface ThemeDefinition {
  id: string
  name: string
  isDark: boolean
  colors: ThemeColors
}
