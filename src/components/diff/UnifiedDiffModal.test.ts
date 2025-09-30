import { describe, expect, it } from 'vitest'
import { shouldBypassHighlighting } from './UnifiedDiffModal'
import type { FileDiffData } from './loadDiffs'

function createDiff(changedLinesCount: number): FileDiffData {
  return {
    file: { path: 'example.ts', change_type: 'modified' },
    diffResult: [],
    changedLinesCount,
    fileInfo: { sizeBytes: 0, language: 'typescript' }
  }
}

describe('shouldBypassHighlighting', () => {
  it('returns true when changed line count exceeds cap', () => {
    const diff = createDiff(4000)
    expect(shouldBypassHighlighting(diff, 3000)).toBe(true)
  })

  it('returns false when changed line count is below cap', () => {
    const diff = createDiff(100)
    expect(shouldBypassHighlighting(diff, 3000)).toBe(false)
  })

  it('returns false when diff data is undefined', () => {
    expect(shouldBypassHighlighting(undefined, 3000)).toBe(false)
  })
})
