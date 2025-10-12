const NON_ALPHANUMERIC = /[^a-zA-Z0-9_-]/g
const SESSION_PREFIX = 'session'
const HASH_SLICE = 6
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

function coerceName(name?: string | null): string {
  if (name == null) return ''
  return `${name}`
}

export function sanitizeSessionName(name?: string | null): string {
  const coerced = coerceName(name)
  const sanitized = coerced.replace(NON_ALPHANUMERIC, '_')
  return sanitized.length > 0 ? sanitized : 'unknown'
}

export function sessionTerminalHash(name?: string | null): string {
  const coerced = coerceName(name)
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < coerced.length; i += 1) {
    hash ^= coerced.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function sessionTerminalBase(name?: string | null): string {
  const sanitized = sanitizeSessionName(name)
  const hash = sessionTerminalHash(name).slice(0, HASH_SLICE)
  return `${SESSION_PREFIX}-${sanitized}~${hash}`
}

export function stableSessionTerminalId(name: string | null | undefined, suffix: string): string {
  const base = sessionTerminalBase(name)
  return `${base}-${suffix}`
}

export function sessionTerminalGroup(name: string | null | undefined): {
  base: string
  top: string
  bottomBase: string
} {
  const base = sessionTerminalBase(name)
  return {
    base,
    top: `${base}-top`,
    bottomBase: `${base}-bottom`
  }
}

function stripTerminalNumericSuffix(id: string): string {
  const lastDash = id.lastIndexOf('-')
  if (lastDash === -1) return id
  const suffix = id.slice(lastDash + 1)
  if (/^\d+$/.test(suffix)) {
    return id.slice(0, lastDash)
  }
  return id
}

export function isTopTerminalId(id: string): boolean {
  if (!id) return false
  if (id.startsWith('run-terminal-')) return false
  const trimmed = stripTerminalNumericSuffix(id)
  return trimmed.endsWith('-top')
}
