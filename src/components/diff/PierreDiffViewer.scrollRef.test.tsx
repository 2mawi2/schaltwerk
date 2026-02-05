import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RefObject } from 'react'
import { createRef } from 'react'
import { PierreDiffViewer, type PierreDiffViewerProps } from './PierreDiffViewer'
import type { FileDiffData } from './loadDiffs'

vi.mock('@pierre/diffs/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@pierre/diffs/react')
  return {
    ...actual,
    FileDiff: vi.fn(() => <div data-testid="pierre-file-diff" />),
  }
})

const mockFileDiff: FileDiffData = {
  file: {
    path: 'src/a.ts',
    change_type: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
  },
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 50, language: 'typescript' },
  totalLineCount: 2,
}

const baseProps: PierreDiffViewerProps = {
  files: [{ path: 'src/a.ts', change_type: 'modified', additions: 1, deletions: 0 }],
  visualFileOrder: ['src/a.ts'],
  selectedFile: 'src/a.ts',
  allFileDiffs: new Map([['src/a.ts', mockFileDiff]]),
  fileError: null,
  branchInfo: null,
  isLargeDiffMode: false,
  isCompactView: false,
  alwaysShowLargeDiffs: false,
  expandedFiles: new Set<string>(),
  onToggleFileExpanded: vi.fn(),
  getCommentsForFile: vi.fn(() => []),
  themeId: 'dark',
  diffStyle: 'unified',
}

describe('PierreDiffViewer scroll container ref', () => {
  it('attaches the external scrollContainerRef to the scroll container element', () => {
    const externalRef = createRef<HTMLDivElement>() as RefObject<HTMLDivElement>

    render(
      <PierreDiffViewer
        {...baseProps}
        scrollContainerRef={externalRef}
      />
    )

    const scrollContainer = screen.getByTestId('diff-scroll-container')
    expect(externalRef.current).toBe(scrollContainer)
  })

  it('uses internal ref when no external scrollContainerRef is provided', () => {
    render(<PierreDiffViewer {...baseProps} />)

    const scrollContainer = screen.getByTestId('diff-scroll-container')
    expect(scrollContainer).toBeTruthy()
  })
})
