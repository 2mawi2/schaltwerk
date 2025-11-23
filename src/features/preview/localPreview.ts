const TRAILING_PUNCTUATION = /[),.;]+$/

const LOCALHOST_PATTERN = /^(?:(https?):\/\/)?(localhost|0\.0\.0\.0|\[?::1\]?|127(?:\.\d{1,3}){3})(?::(\d{2,5}))?(\/[\S]*)?$/i

export function normalizeLocalhostUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const cleaned = trimmed.replace(TRAILING_PUNCTUATION, '')
  const match = cleaned.match(LOCALHOST_PATTERN)
  if (!match) return null

  const [, protocolRaw, hostRaw, portRaw, pathRaw] = match
  const protocol = (protocolRaw ?? 'http').toLowerCase()
  const hostLower = hostRaw.toLowerCase()

  const isLoopbackV4 = hostLower === '0.0.0.0' || hostLower === 'localhost'
  const isIpv6Loopback = hostLower === '::1' || hostLower === '[::1]'
  const is127 = hostLower.startsWith('127.')

  let normalizedHost = 'localhost'
  if (is127) {
    // Preserve 127.x.y.z exactly as provided (case-insensitive but digits only)
    normalizedHost = hostRaw
  } else if (isLoopbackV4 || isIpv6Loopback) {
    normalizedHost = 'localhost'
  } else {
    return null
  }

  const port = portRaw ? `:${portRaw}` : ''
  const path = pathRaw ?? ''

  return `${protocol}://${normalizedHost}${port}${path}`
}

export function isLocalhostUrl(url: string): boolean {
  return normalizeLocalhostUrl(url) !== null
}

interface LocalPreviewWatcherOptions {
  previewKey: string
  interceptClicks: boolean
  onUrl: (url: string) => void
  onOpenPreviewPanel?: () => void
  getCurrentUrl?: () => string | null
}

export class LocalPreviewWatcher {
  private lastUrl: string | null = null
  private readonly options: LocalPreviewWatcherOptions

  constructor(options: LocalPreviewWatcherOptions) {
    this.options = options
  }

  handleClick(rawUrl: string | null | undefined): boolean {
    if (!this.options.interceptClicks) return false
    if (!rawUrl) return false
    const normalized = normalizeLocalhostUrl(rawUrl)
    if (!normalized) return false

    this.applyUrl(normalized)
    return true
  }

  private applyUrl(url: string | null): string | null {
    if (!url) return null
    const isCurrent = this.lastUrl === url || (this.options.getCurrentUrl && this.options.getCurrentUrl() === url)

    if (!isCurrent) {
      this.lastUrl = url
      this.options.onUrl(url)
    }

    this.options.onOpenPreviewPanel?.()

    return url
  }
}
