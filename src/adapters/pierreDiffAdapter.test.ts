import { describe, expect, it } from 'vitest'
import { convertDiffResponseToFileDiffMetadata } from './pierreDiffAdapter'
import type { DiffResponse } from '../types/diff'

describe('convertDiffResponseToFileDiffMetadata', () => {
  it('normalizes content into Pierre 1.1 line arrays and indexed hunk segments', () => {
    const response: DiffResponse = {
      lines: [
        { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const stable = true' },
        { type: 'removed', oldLineNumber: 2, content: 'const name = "old"' },
        { type: 'added', newLineNumber: 2, content: 'const name = "new"' },
      ],
      stats: { additions: 1, deletions: 1 },
      fileInfo: { sizeBytes: 64, language: 'typescript' },
      isLargeFile: false,
      isBinary: false,
    }

    const result = convertDiffResponseToFileDiffMetadata(response, 'src/example.ts')

    expect(result.fileDiff).toMatchObject({
      isPartial: true,
      additionLines: ['const stable = true\n', 'const name = "new"\n'],
      deletionLines: ['const stable = true\n', 'const name = "old"\n'],
    })
    expect(result.fileDiff.hunks).toHaveLength(1)
    expect(result.fileDiff.hunks[0]).toMatchObject({
      additionCount: 2,
      deletionCount: 2,
      additionLines: 1,
      deletionLines: 1,
      additionLineIndex: 0,
      deletionLineIndex: 0,
      noEOFCRAdditions: false,
      noEOFCRDeletions: false,
      hunkContent: [
        { type: 'context', lines: 1, additionLineIndex: 0, deletionLineIndex: 0 },
        { type: 'change', additions: 1, deletions: 1, additionLineIndex: 1, deletionLineIndex: 1 },
      ],
    })
  })
})
