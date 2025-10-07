import { describe, expect, it } from 'vitest'
import { hashSegments } from './hashSegments'

describe('hashSegments', () => {
  it('returns stable hash for identical input', () => {
    const value = hashSegments(['const a = 1;', 'return a;'])
    const again = hashSegments(['const a = 1;', 'return a;'])
    expect(value).toBe(again)
  })

  it('changes hash when content mutates but length stays the same', () => {
    const before = hashSegments(['let id = foo;', 'console.log(id);'])
    const after = hashSegments(['let id = bar;', 'console.log(id);'])
    expect(before).not.toBe(after)
  })
})
