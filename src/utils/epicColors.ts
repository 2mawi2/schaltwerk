import { theme } from '../common/theme'

export const EPIC_COLOR_KEYS = [
    'blue',
    'green',
    'amber',
    'violet',
    'red',
    'magenta',
    'yellow',
    'cyan',
    'purple',
] as const

export type EpicColorKey = (typeof EPIC_COLOR_KEYS)[number]

type AccentScheme = typeof theme.colors.accent.blue

const COLOR_LABELS: Record<EpicColorKey, string> = {
    blue: 'Blue',
    green: 'Green',
    amber: 'Amber',
    violet: 'Violet',
    red: 'Red',
    magenta: 'Magenta',
    yellow: 'Yellow',
    cyan: 'Cyan',
    purple: 'Purple',
}

export function getEpicAccentScheme(color: string | null | undefined): AccentScheme | null {
    switch (color) {
        case 'blue':
            return theme.colors.accent.blue
        case 'green':
            return theme.colors.accent.green
        case 'amber':
            return theme.colors.accent.amber
        case 'violet':
            return theme.colors.accent.violet
        case 'red':
            return theme.colors.accent.red
        case 'magenta':
            return theme.colors.accent.magenta
        case 'yellow':
            return theme.colors.accent.yellow
        case 'cyan':
            return theme.colors.accent.cyan
        case 'purple':
            return theme.colors.accent.purple
        default:
            return null
    }
}

export function labelForEpicColor(color: EpicColorKey): string {
    return COLOR_LABELS[color]
}

