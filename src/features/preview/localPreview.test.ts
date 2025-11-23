import { describe, it, expect, vi } from 'vitest'
import { normalizeLocalhostUrl, LocalPreviewWatcher, isLocalhostUrl } from './localPreview'

describe('local preview URL detection', () => {
  it('normalizes bare localhost variants and preserves paths/query/hash', () => {
    const samples: Array<[string, string]> = [
      ['localhost:3000', 'http://localhost:3000'],
      ['0.0.0.0:8080/', 'http://localhost:8080/'],
      ['127.0.0.1:5000/app?foo=bar#hash', 'http://127.0.0.1:5000/app?foo=bar#hash'],
      ['[::1]:4000', 'http://localhost:4000'],
      ['https://localhost:3001/', 'https://localhost:3001/'],
    ]

    for (const [input, expected] of samples) {
      expect(normalizeLocalhostUrl(input)).toBe(expected)
    }
  })

  it('detects localhost-style URLs via isLocalhostUrl', () => {
    expect(isLocalhostUrl('http://localhost:1234')).toBe(true)
    expect(isLocalhostUrl('127.0.0.1:5000')).toBe(true)
    expect(isLocalhostUrl('https://example.com')).toBe(false)
  })

  it('trims trailing punctuation when extracting', () => {
    const log = 'http://localhost:3000,'
    expect(normalizeLocalhostUrl(log)).toBe('http://localhost:3000')
  })

  it('ignores non-localhost hosts even if they include ports', () => {
    const log = 'External: https://example.com:3000/path'
    expect(normalizeLocalhostUrl(log)).toBeNull()
  })
})

describe('LocalPreviewWatcher', () => {
  it('keeps the last detected URL when multiple appear', () => {
    const setPreview = vi.fn()
    const watcher = new LocalPreviewWatcher({
      previewKey: 'test',
      interceptClicks: true,
      onUrl: setPreview,
      onOpenPreviewPanel: vi.fn(),
    })

    watcher.handleClick('http://localhost:3000')
    watcher.handleClick('http://localhost:3001')

    expect(setPreview).toHaveBeenLastCalledWith('http://localhost:3001')
  })
})
