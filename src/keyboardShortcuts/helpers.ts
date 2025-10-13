import { KeyboardShortcutAction, KeyboardShortcutConfig, defaultShortcutConfig } from './config'
import { MatchOptions, detectPlatform, matchesShortcut } from './matcher'
import type { Platform } from './matcher'

export interface ActionMatchOptions extends MatchOptions {}

export const resolveConfig = (config?: KeyboardShortcutConfig): KeyboardShortcutConfig => {
  return config ?? defaultShortcutConfig
}

export const isShortcutForAction = (
  event: KeyboardEvent,
  action: KeyboardShortcutAction,
  config: KeyboardShortcutConfig | undefined,
  options: ActionMatchOptions = {},
): boolean => {
  const bindings = resolveConfig(config)[action] ?? []
  if (!bindings.length) return false

  const platform = options.platform ?? detectPlatform()

  return bindings.some(binding => matchesShortcut(event, binding, { platform }))
}

export const detectPlatformSafe = detectPlatform

const MAC_CMD_SYMBOL = '⌘'
const MAC_ALT_SYMBOL = '⌥'
const SHIFT_SYMBOL = '⇧'

export const getDisplayLabelForSegment = (segment: string, platform: Platform): string => {
  switch (segment) {
    case 'Mod':
      return platform === 'mac' ? MAC_CMD_SYMBOL : 'Ctrl'
    case 'Meta':
      return MAC_CMD_SYMBOL
    case 'Ctrl':
      return 'Ctrl'
    case 'Alt':
      return platform === 'mac' ? MAC_ALT_SYMBOL : 'Alt'
    case 'Shift':
      return SHIFT_SYMBOL
    default:
      return segment
  }
}

export const splitShortcutBinding = (binding: string): string[] => {
  if (!binding) return []
  return binding.split('+')
}

export const formatShortcutForDisplay = (segments: string[], platform: Platform): string => {
  if (platform === 'mac') {
    // macOS: display symbols directly without separators (⌘T, ⇧⌘<, etc.)
    return segments.map(seg => getDisplayLabelForSegment(seg, platform)).join('')
  } else {
    // non-macOS: display with spaces and + symbols (Ctrl + Shift + T)
    return segments.map((seg, index) => {
      const label = getDisplayLabelForSegment(seg, platform)
      const isLast = index === segments.length - 1
      return label + (!isLast ? ' + ' : '')
    }).join('')
  }
}
