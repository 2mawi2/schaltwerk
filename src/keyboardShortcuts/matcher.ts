export type Platform = 'mac' | 'windows' | 'linux'

export interface MatchOptions {
  platform?: Platform
}

const MODIFIER_ALIASES: Record<string, string> = {
  mod: 'Mod',
  primary: 'Mod',
  meta: 'Meta',
  command: 'Meta',
  cmd: 'Meta',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
}

const REQUIRED_ORDER = ['Mod', 'Meta', 'Ctrl', 'Alt', 'Shift'] as const

const KEY_ALIASES: Record<string, string> = {
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  arrowup: 'ArrowUp',
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  plus: '=',
  add: '=',
  minus: '-',
  subtract: '-',
  slash: '/',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  semicolon: ';',
  quote: "'",
}

interface ParsedShortcut {
  key: string | null
  required: Set<string>
  optional: Set<string>
}

const parseShortcut = (shortcut: string): ParsedShortcut => {
  const tokens = (shortcut || '')
    .split('+')
    .map(token => token.trim())
    .filter(Boolean)

  const required = new Set<string>()
  const optional = new Set<string>()
  let key: string | null = null

  tokens.forEach(token => {
    const optionalMatch = token.match(/^\[(.*)]$/)
    if (optionalMatch) {
      const value = optionalMatch[1].trim()
      const canonical = canonicalizeModifier(value)
      if (canonical) {
        optional.add(canonical)
      } else {
        // Treat optional key the same as required key for normalization purposes
        if (!key) {
          key = normalizeKey(value)
        }
      }
      return
    }

    const canonical = canonicalizeModifier(token)
    if (canonical) {
      required.add(canonical)
      return
    }

    if (!key) {
      key = normalizeKey(token)
    }
  })

  return { key, required, optional }
}

const canonicalizeModifier = (token: string): string | null => {
  const lowered = token.trim().toLowerCase()
  if (!lowered) return null
  const canonical = MODIFIER_ALIASES[lowered]
  if (canonical) return canonical
  if (REQUIRED_ORDER.includes(token.trim() as typeof REQUIRED_ORDER[number])) {
    return token.trim()
  }
  return null
}

const normalizeKey = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withoutPrefix = trimmed.startsWith('Key')
    ? trimmed.slice(3)
    : trimmed.startsWith('Digit')
      ? trimmed.slice(5)
      : trimmed

  const lowered = withoutPrefix.toLowerCase()
  if (KEY_ALIASES[lowered]) {
    return KEY_ALIASES[lowered]
  }

  if (withoutPrefix.length === 1) {
    // Treat plus as equal so Cmd + = works without requiring Shift
    if (withoutPrefix === '+') return '='
    return withoutPrefix.toUpperCase()
  }

  return withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1)
}

const normalizeEventKey = (key: string): string => {
  if (!key) return ''
  if (key.length === 1) {
    if (key === '+') return '='
    return key === key.toUpperCase() ? key : key.toUpperCase()
  }
  const lowered = key.toLowerCase()
  if (KEY_ALIASES[lowered]) {
    return KEY_ALIASES[lowered]
  }
  return key.charAt(0).toUpperCase() + key.slice(1)
}

const buildModifierFlags = (set: Set<string>, platform: Platform) => {
  const has = (value: string) => set.has(value)
  const primaryIsMeta = platform === 'mac'

  const primary = has('Mod')

  return {
    meta: has('Meta') || (primary && primaryIsMeta),
    ctrl: has('Ctrl') || (primary && !primaryIsMeta),
    alt: has('Alt'),
    shift: has('Shift'),
    primary,
  }
}

export const normalizeShortcut = (shortcut: string): string => {
  const { key, required, optional } = parseShortcut(shortcut)

  if (!key && required.size === 0 && optional.size === 0) {
    return ''
  }

  const orderedRequired = REQUIRED_ORDER.filter(token => required.has(token))
  const orderedOptional = REQUIRED_ORDER.filter(token => optional.has(token)).map(token => `[${token}]`)
  const tokens: string[] = [...orderedRequired, ...orderedOptional]

  if (key) {
    tokens.push(key)
  }

  return tokens.join('+')
}

export const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') {
    return 'mac'
  }
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

const isModifierAllowed = (flag: boolean, optional: boolean, active: boolean) => {
  if (flag) {
    return active
  }

  if (!optional && active) {
    return false
  }

  return true
}

export const matchesShortcut = (
  event: KeyboardEvent,
  shortcut: string,
  options: MatchOptions = {},
): boolean => {
  const normalized = normalizeShortcut(shortcut)
  if (!normalized) return false

  const parsed = parseShortcut(normalized)
  if (!parsed.key) return false

  const platform = options.platform ?? detectPlatform()
  const key = parsed.key
  const eventKey = normalizeEventKey(event.key)

  if (eventKey !== key) {
    return false
  }

  const requiredFlags = buildModifierFlags(parsed.required, platform)
  const optionalFlags = buildModifierFlags(parsed.optional, platform)

  let metaAllowed = optionalFlags.meta || requiredFlags.meta
  let ctrlAllowed = optionalFlags.ctrl || requiredFlags.ctrl
  if (requiredFlags.primary || optionalFlags.primary) {
    if (platform === 'mac') {
      ctrlAllowed = true
    } else {
      metaAllowed = true
    }
  }
  const altAllowed = optionalFlags.alt || requiredFlags.alt
  const shiftAllowed = optionalFlags.shift || requiredFlags.shift

  if (requiredFlags.meta && !event.metaKey) return false
  if (!isModifierAllowed(requiredFlags.meta, metaAllowed, event.metaKey)) return false

  if (requiredFlags.ctrl && !event.ctrlKey) return false
  if (!isModifierAllowed(requiredFlags.ctrl, ctrlAllowed, event.ctrlKey)) return false

  if (requiredFlags.alt && !event.altKey) return false
  if (!isModifierAllowed(requiredFlags.alt, altAllowed, event.altKey)) return false

  if (requiredFlags.shift && !event.shiftKey) return false
  if (!isModifierAllowed(requiredFlags.shift, shiftAllowed, event.shiftKey)) return false

  return true
}

export const shortcutFromEvent = (
  event: KeyboardEvent,
  options: MatchOptions = {},
): string => {
  const platform = options.platform ?? detectPlatform()
  const parts: string[] = []
  const primaryIsMeta = platform === 'mac'

  if (primaryIsMeta) {
    if (event.metaKey) parts.push('Mod')
    if (event.ctrlKey) parts.push('Ctrl')
  } else {
    if (event.ctrlKey) parts.push('Mod')
    if (event.metaKey) parts.push('Meta')
  }

  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = normalizeEventKey(event.key)
  if (key) {
    parts.push(key)
  }

  return normalizeShortcut(parts.join('+'))
}
