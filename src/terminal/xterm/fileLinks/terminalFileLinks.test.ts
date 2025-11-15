import { describe, expect, it } from 'vitest'

import {
  parseTerminalFileReference,
  resolveTerminalFileReference,
} from './terminalFileLinks'

describe('parseTerminalFileReference', () => {
  it('extracts relative paths with line ranges', () => {
    const result = parseTerminalFileReference('src/components/TopBar.tsx:92-99')

    expect(result).toEqual({
      filePath: 'src/components/TopBar.tsx',
      startLine: 92,
      endLine: 99,
    })
  })

  it('supports GitHub style #L references', () => {
    const result = parseTerminalFileReference('src/lib/app.rs#L12-L20')

    expect(result).toEqual({
      filePath: 'src/lib/app.rs',
      startLine: 12,
      endLine: 20,
    })
  })

  it('rejects obvious URLs', () => {
    expect(parseTerminalFileReference('https://example.com')).toBeNull()
    expect(parseTerminalFileReference('http://localhost:3000')).toBeNull()
  })

  it('trims surrounding quotes before parsing', () => {
    const result = parseTerminalFileReference('"src/lib/mod.ts:12"')

    expect(result).toEqual({ filePath: 'src/lib/mod.ts', startLine: 12, endLine: undefined })
  })

  it('rejects colon references that actually point to URLs', () => {
    expect(parseTerminalFileReference('https://example.com/app.ts:9')).toBeNull()
  })

  it('rejects paths without an extension in the last segment', () => {
    expect(parseTerminalFileReference('LICENSE:5')).toBeNull()
  })
})

describe('resolveTerminalFileReference', () => {
  it('joins relative paths with the provided base directory', () => {
    const resolved = resolveTerminalFileReference(
      { filePath: 'src/components/App.tsx' },
      '/Users/test/project'
    )

    expect(resolved).toBe('/Users/test/project/src/components/App.tsx')
  })

  it('returns absolute paths untouched', () => {
    const absolute = '/Users/test/project/src/main.rs'

    const resolved = resolveTerminalFileReference({ filePath: absolute })

    expect(resolved).toBe(absolute)
  })

  it('normalizes absolute paths with parent segments', () => {
    const resolved = resolveTerminalFileReference({
      filePath: '/Users/test/project/../secrets/.env'
    })

    expect(resolved).toBe('/Users/test/secrets/.env')
  })
})
