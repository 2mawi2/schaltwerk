import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { DiffViewer, DiffViewerProps } from './DiffViewer'

const mockFileDiff = {
  diffResult: [
    { type: 'unchanged' as const, content: 'line 1', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'added' as const, content: 'line 2', oldLineNumber: undefined, newLineNumber: 2 },
  ],
  fileInfo: { language: 'typescript', sizeBytes: 128 },
  isBinary: false,
  file: { path: 'src/file.ts', change_type: 'modified' as const },
  changedLinesCount: 1
}

const baseProps: Partial<DiffViewerProps> = {
  files: [{ path: 'src/file.ts', change_type: 'modified' as const }],
  selectedFile: 'src/file.ts',
  allFileDiffs: new Map([['src/file.ts', mockFileDiff]]),
  fileError: null,
  branchInfo: null,
  expandedSectionsByFile: new Map(),
  isLargeDiffMode: true,
  visibleFileSet: new Set(['src/file.ts']),
  renderedFileSet: new Set(['src/file.ts']),
  loadingFiles: new Set(),
  observerRef: { current: null },
  scrollContainerRef: { current: null } as unknown as React.RefObject<HTMLDivElement>,
  fileRefs: { current: new Map() },
  fileBodyHeights: new Map(),
  onFileBodyHeightChange: vi.fn(),
  getCommentsForFile: vi.fn(() => []),
  highlightCode: vi.fn((_filePath: string, _lineKey: string, code: string) => code),
  toggleCollapsed: vi.fn(),
  handleLineMouseDown: vi.fn(),
  handleLineMouseEnter: vi.fn(),
  handleLineMouseLeave: vi.fn(),
  handleLineMouseUp: vi.fn(),
  lineSelection: {
    isLineSelected: vi.fn(() => false),
    selection: null,
  }
}

describe('DiffViewer context menus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows copying a line number via context menu', () => {
    const onCopyLine = vi.fn()

    render(<DiffViewer {...baseProps as DiffViewerProps} onCopyLine={onCopyLine} />)

    const lineCells = screen.getAllByRole('cell', { name: /1/ })
    const lineCell = lineCells[0]

    fireEvent.contextMenu(lineCell)

    const menu = screen.getByRole('menu')
    const copyItem = within(menu).getByRole('menuitem', { name: /Copy line 1/ })
    fireEvent.click(copyItem)

    expect(onCopyLine).toHaveBeenCalledWith({ filePath: 'src/file.ts', lineNumber: 1, side: 'new' })
  })

  it('exposes comment creation through code cell context menu', () => {
    const onStartComment = vi.fn()

    render(<DiffViewer {...baseProps as DiffViewerProps} onStartCommentFromContext={onStartComment} />)

    const codeCell = screen.getByText('line 2')
    fireEvent.contextMenu(codeCell)

    const menu = screen.getByRole('menu')
    const commentItem = within(menu).getByRole('menuitem', { name: /Start comment thread/ })
    fireEvent.click(commentItem)

    expect(onStartComment).toHaveBeenCalledWith({ filePath: 'src/file.ts', lineNumber: 2, side: 'new' })
  })
})
