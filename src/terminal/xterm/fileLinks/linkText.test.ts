import { describe, expect, it } from 'vitest'

import { findLinkMatches } from './linkText'

describe('findLinkMatches', () => {
  it('returns every regex match when validator accepts', () => {
    const matches = findLinkMatches('foo.ts:10 bar.ts:20', /\w+\.ts:\d+/)

    expect(matches).toEqual([
      { text: 'foo.ts:10', start: 0, end: 9 },
      { text: 'bar.ts:20', start: 10, end: 19 },
    ])
  })

  it('reuses the original flags and injects global when missing', () => {
    const pattern = /src\/\w+\.rs/gi
    const matches = findLinkMatches('SRC/main.rs src/lib.rs', pattern)

    expect(matches).toEqual([
      { text: 'SRC/main.rs', start: 0, end: 11 },
      { text: 'src/lib.rs', start: 12, end: 22 },
    ])
    expect(pattern.flags).toBe('gi')
  })

  it('skips matches rejected by the validator', () => {
    const matches = findLinkMatches('foo.ts bar.ts', /\w+\.ts/g, text => text.startsWith('bar'))

    expect(matches).toEqual([{ text: 'bar.ts', start: 7, end: 13 }])
  })
})
