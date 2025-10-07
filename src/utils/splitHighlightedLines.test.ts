import { describe, expect, it } from 'vitest'
import { splitHighlightedLines } from './splitHighlightedLines'

describe('splitHighlightedLines', () => {
  it('returns single line unchanged when no newline is present', () => {
    const input = '<span class="hljs-keyword">const</span> value = <span class="hljs-number">1</span>;'
    expect(splitHighlightedLines(input)).toEqual([input])
  })

  it('splits multi-line spans while keeping formatting intact', () => {
    const input = '<span class="hljs-string">hello\nworld</span>'
    expect(splitHighlightedLines(input)).toEqual([
      '<span class="hljs-string">hello</span>',
      '<span class="hljs-string">world</span>'
    ])
  })

  it('reopens nested spans after newline boundaries', () => {
    const input = '<span class="hljs-function"><span class="hljs-string">line1\nline2</span></span>'

    expect(splitHighlightedLines(input)).toEqual([
      '<span class="hljs-function"><span class="hljs-string">line1</span></span>',
      '<span class="hljs-function"><span class="hljs-string">line2</span></span>'
    ])
  })
})
