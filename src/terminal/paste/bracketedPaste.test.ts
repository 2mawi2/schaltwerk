import { describe, it, expect } from 'vitest'
import { BRACKETED_PASTE_PREFIX, BRACKETED_PASTE_SUFFIX, buildBracketedPasteChunks } from './bracketedPaste'

describe('buildBracketedPasteChunks', () => {
  it('wraps empty text in bracket markers', () => {
    expect(buildBracketedPasteChunks('')).toEqual([BRACKETED_PASTE_PREFIX, BRACKETED_PASTE_SUFFIX])
  })

  it('wraps text and preserves contents', () => {
    const chunks = buildBracketedPasteChunks('hello')
    expect(chunks[0]).toBe(BRACKETED_PASTE_PREFIX)
    expect(chunks[chunks.length - 1]).toBe(BRACKETED_PASTE_SUFFIX)
    expect(chunks.slice(1, -1).join('')).toBe('hello')
  })

  it('does not split surrogate pairs', () => {
    const text = `a😀b`
    const chunks = buildBracketedPasteChunks(text, 2)
    expect(chunks.slice(1, -1).join('')).toBe(text)
    // With a tiny chunk size, emoji should still survive intact.
    expect(buildBracketedPasteChunks('😀', 1).slice(1, -1).join('')).toBe('😀')
  })
})

