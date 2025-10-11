import { describe, expect, it } from 'vitest'
import { shouldBypassHighlighting, computeHistorySeedWindow, computeLargeDiffVisibleSet } from './UnifiedDiffModal'
import type { FileDiffData } from './loadDiffs'
import type { ChangedFile } from './DiffFileExplorer'

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

describe('history diff helpers', () => {
  const makeFiles = (paths: string[]): ChangedFile[] =>
    paths.map(path => ({ path, change_type: 'modified' }))

  it('computes seed window around selected file', () => {
    const files = makeFiles(['a', 'b', 'c', 'd', 'e'])
    const seeded = computeHistorySeedWindow(files, 2)
    expect(Array.from(seeded)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('clamps seed window at boundaries', () => {
    const files = makeFiles(['a', 'b', 'c'])
    const seeded = computeHistorySeedWindow(files, 0, 1)
    expect(Array.from(seeded)).toEqual(['a', 'b'])
  })

  it('computes large diff visible set with optional neighbors', () => {
    const files = makeFiles(['a', 'b', 'c'])
    expect(Array.from(computeLargeDiffVisibleSet(files, 'b'))).toEqual(['b'])
    expect(Array.from(computeLargeDiffVisibleSet(files, 'b', true))).toEqual(['b', 'a', 'c'])
  })
})
