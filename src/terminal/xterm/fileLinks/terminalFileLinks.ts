const TRAILING_QUOTE_PATTERN = /["')]+$/
const LEADING_QUOTE_PATTERN = /^["'(]+/
const HASH_RANGE_PATTERN = /#L(\d+)(?:-L?(\d+))?$/i
const COLON_RANGE_PATTERN = /:(\d+)(?:(?:-|:)(\d+))?$/
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/

export interface TerminalFileReference {
  filePath: string
  startLine?: number
  endLine?: number
}

export const TERMINAL_FILE_LINK_REGEX = new RegExp(
  String.raw`[A-Za-z0-9._~/\\-]+\.[A-Za-z0-9._~-]+(?:(?:[:#]L?)?[0-9][0-9L:-]*)?`,
  'g'
)

export function parseTerminalFileReference(input: string | null | undefined): TerminalFileReference | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  let candidate = trimmed.replace(LEADING_QUOTE_PATTERN, '').replace(TRAILING_QUOTE_PATTERN, '')
  if (!candidate) return null
  if (candidate.includes('://')) return null
  if (!candidate.includes('.')) return null

  let startLine: number | undefined
  let endLine: number | undefined

  const hashMatch = candidate.match(HASH_RANGE_PATTERN)
  if (hashMatch) {
    candidate = candidate.slice(0, -hashMatch[0].length)
    startLine = parseInt(hashMatch[1], 10)
    endLine = hashMatch[2] ? parseInt(hashMatch[2], 10) : undefined
  } else {
    const colonMatch = candidate.match(COLON_RANGE_PATTERN)
    if (colonMatch) {
      const sliceEnd = candidate.length - colonMatch[0].length
      // Guard against paths like https:// or Windows drive letters
      const preceding = candidate.slice(0, sliceEnd)
      if (!preceding.includes('://')) {
        candidate = preceding
        startLine = parseInt(colonMatch[1], 10)
        endLine = colonMatch[2] ? parseInt(colonMatch[2], 10) : undefined
      }
    }
  }

  const sanitizedPath = candidate.trim().replace(TRAILING_QUOTE_PATTERN, '')
  if (!sanitizedPath || sanitizedPath.includes('://')) {
    return null
  }

  const lastSegment = sanitizedPath.split(/[\\/]/).pop() ?? ''
  if (!lastSegment.includes('.')) {
    return null
  }
  if (!/[a-zA-Z]/.test(lastSegment)) {
    return null
  }

  return { filePath: sanitizedPath, startLine, endLine }
}

export function resolveTerminalFileReference(ref: TerminalFileReference, basePath?: string | null): string | null {
  if (!ref.filePath) {
    return null
  }

  const target = ref.filePath
  if (target.startsWith('file://')) {
    try {
      const url = new URL(target)
      return normalizeFileUrlPath(url)
    } catch {
      return null
    }
  }

  if (target.startsWith('/') || WINDOWS_DRIVE_PATTERN.test(target)) {
    return normalizePath(target)
  }

  if (!basePath) {
    return null
  }

  try {
    const base = ensureBaseFileUrl(basePath)
    const resolved = new URL(target, base)
    return normalizeFileUrlPath(resolved)
  } catch {
    return null
  }
}

function normalizeFileUrlPath(url: URL): string {
  let decoded = decodeURIComponent(url.pathname)
  if (decoded.startsWith('/') && /^[a-zA-Z]:/.test(decoded.slice(1))) {
    decoded = decoded.slice(1)
  }
  return normalizePath(decoded)
}

function ensureBaseFileUrl(basePath: string): URL {
  const sanitized = normalizePath(basePath)
  let withTrailingSlash = sanitized.endsWith('/') ? sanitized : `${sanitized}/`
  if (!withTrailingSlash.startsWith('/')) {
    withTrailingSlash = `/${withTrailingSlash}`
  }
  return new URL(`file://${withTrailingSlash}`)
}

function normalizePath(path: string): string {
  if (!path) return ''
  let replaced = path.replace(/\\/g, '/').replace(/\/\//g, '/')

  const driveMatch = replaced.match(/^[a-zA-Z]:/)
  let drive = ''
  if (driveMatch) {
    drive = driveMatch[0]
    replaced = replaced.slice(drive.length)
  }

  const isAbsolute = replaced.startsWith('/')
  const segments = replaced.split('/')
  const stack: string[] = []

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (stack.length > 0) {
        stack.pop()
      } else if (!isAbsolute && !drive) {
        stack.push('..')
      }
      continue
    }
    stack.push(segment)
  }

  let normalized = stack.join('/')
  if (isAbsolute) {
    normalized = normalized ? `/${normalized}` : '/'
  }

  normalized = normalized.replace(/\/\//g, '/')

  if (!normalized || normalized === '/') {
    if (drive) {
      return drive + (isAbsolute ? '/' : '')
    }
    return normalized || (isAbsolute ? '/' : '')
  }

  if (drive) {
    if (normalized.startsWith('/')) {
      return `${drive}${normalized}`
    }
    return `${drive}/${normalized}`
  }

  return normalized
}
