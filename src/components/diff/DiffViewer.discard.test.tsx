import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { DiffViewer, DiffViewerProps } from './DiffViewer'

const mockFileDiff = {
  diffResult: [
    { type: 'unchanged' as const, content: 'unchanged line 1', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'removed' as const, content: 'removed line', oldLineNumber: 2, newLineNumber: undefined },
    { type: 'added' as const, content: 'added line', oldLineNumber: undefined, newLineNumber: 2 },
    { type: 'unchanged' as const, content: 'unchanged line 2', oldLineNumber: 3, newLineNumber: 3 },
  ],
  fileInfo: { language: 'typescript', sizeBytes: 1024 },
  isBinary: false,
  file: { path: 'src/file1.ts', change_type: 'modified' as const, additions: 1, deletions: 1, changes: 2 },
  changedLinesCount: 2
}

const mockFiles = [
  { path: 'src/file1.ts', change_type: 'modified' as const, additions: 1, deletions: 0, changes: 1 },
  { path: 'src/file2.tsx', change_type: 'added' as const, additions: 1, deletions: 0, changes: 1 },
]

const createMockProps = (overrides?: Partial<DiffViewerProps>): DiffViewerProps => ({
  files: mockFiles,
  selectedFile: 'src/file1.ts',
  allFileDiffs: new Map([['src/file1.ts', mockFileDiff]]),
  fileError: null,
  branchInfo: {
    currentBranch: 'feature/test',
    baseBranch: 'main',
    baseCommit: 'abc1234',
    headCommit: 'def5678'
  },
  expandedSectionsByFile: new Map<string, Set<number>>(),
  isLargeDiffMode: true,
  visibleFileSet: new Set(['src/file1.ts']),
  renderedFileSet: new Set(['src/file1.ts']),
  loadingFiles: new Set<string>(),
  observerRef: { current: null },
  scrollContainerRef: { current: null } as unknown as React.RefObject<HTMLDivElement>,
  fileRefs: { current: new Map() },
  fileBodyHeights: new Map<string, number>(),
  alwaysShowLargeDiffs: false,
  expandedFiles: new Set<string>(),
  onToggleFileExpanded: vi.fn(),
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
    selection: null
  },
  ...overrides
})

describe('DiffViewer - Discard File Button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows discard button when onDiscardFile is provided', () => {
    const onDiscardFile = vi.fn()
    const props = createMockProps({ onDiscardFile })

    render(<DiffViewer {...props} />)

    const discardButton = screen.getByLabelText('Discard src/file1.ts')
    expect(discardButton).toBeInTheDocument()
    expect(discardButton).toHaveAttribute('title', 'Discard changes for this file')
  })

  it('does not show discard button when onDiscardFile is not provided', () => {
    const props = createMockProps({ onDiscardFile: undefined })

    render(<DiffViewer {...props} />)

    const discardButton = screen.queryByLabelText('Discard src/file1.ts')
    expect(discardButton).not.toBeInTheDocument()
  })

  it('opens confirmation dialog when discard button is clicked', async () => {
    const user = userEvent.setup()
    const onDiscardFile = vi.fn()
    const props = createMockProps({ onDiscardFile })

    render(<DiffViewer {...props} />)

    const discardButton = screen.getByLabelText('Discard src/file1.ts')
    await user.click(discardButton)

    await waitFor(() => {
      expect(screen.getByText('Discard File Changes')).toBeInTheDocument()
      expect(screen.getByText(/This will discard all uncommitted changes for the file/)).toBeInTheDocument()
      const dialogFilePathElements = screen.getAllByText('src/file1.ts')
      expect(dialogFilePathElements.length).toBeGreaterThan(0)
    })
  })

  it('calls onDiscardFile when confirmation is confirmed', async () => {
    const user = userEvent.setup()
    const onDiscardFile = vi.fn().mockResolvedValue(undefined)
    const props = createMockProps({ onDiscardFile })

    render(<DiffViewer {...props} />)

    const discardButton = screen.getByLabelText('Discard src/file1.ts')
    await user.click(discardButton)

    await waitFor(() => {
      expect(screen.getByText('Discard File Changes')).toBeInTheDocument()
    })

    const confirmButtons = screen.getAllByRole('button', { name: /discard/i })
    const confirmButton = confirmButtons.find(btn => btn.className.includes('bg-red'))
    expect(confirmButton).toBeDefined()
    await user.click(confirmButton!)

    await waitFor(() => {
      expect(onDiscardFile).toHaveBeenCalledWith('src/file1.ts')
    })
  })

  it('closes dialog without calling onDiscardFile when cancelled', async () => {
    const user = userEvent.setup()
    const onDiscardFile = vi.fn()
    const props = createMockProps({ onDiscardFile })

    render(<DiffViewer {...props} />)

    const discardButton = screen.getByLabelText('Discard src/file1.ts')
    await user.click(discardButton)

    await waitFor(() => {
      expect(screen.getByText('Discard File Changes')).toBeInTheDocument()
    })

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByText('Discard File Changes')).not.toBeInTheDocument()
    })

    expect(onDiscardFile).not.toHaveBeenCalled()
  })

  it('shows discard button in continuous scroll mode', () => {
    const onDiscardFile = vi.fn()
    const props = createMockProps({
      onDiscardFile,
      isLargeDiffMode: false,
      allFileDiffs: new Map([
        ['src/file1.ts', mockFileDiff],
        ['src/file2.tsx', mockFileDiff]
      ])
    })

    render(<DiffViewer {...props} />)

    const discardButtons = screen.getAllByTitle('Discard changes for this file')
    expect(discardButtons.length).toBeGreaterThan(0)
  })

  it('handles multiple files with different discard actions', async () => {
    const user = userEvent.setup()
    const onDiscardFile = vi.fn().mockResolvedValue(undefined)
    const file2Diff = {
      ...mockFileDiff,
      file: { path: 'src/file2.tsx', change_type: 'modified' as const, additions: 1, deletions: 0, changes: 1 }
    }
    const props = createMockProps({
      onDiscardFile,
      isLargeDiffMode: false,
      files: mockFiles,
      allFileDiffs: new Map([
        ['src/file1.ts', mockFileDiff],
        ['src/file2.tsx', file2Diff]
      ]),
      visibleFileSet: new Set(['src/file1.ts', 'src/file2.tsx']),
      renderedFileSet: new Set(['src/file1.ts', 'src/file2.tsx'])
    })

    render(<DiffViewer {...props} />)

    const discardButton2 = screen.getByLabelText('Discard src/file2.tsx')
    await user.click(discardButton2)

    await waitFor(() => {
      const filePathElements = screen.getAllByText('src/file2.tsx')
      expect(filePathElements.length).toBeGreaterThan(0)
    })

    const confirmButtons = screen.getAllByRole('button', { name: /discard/i })
    const confirmButton = confirmButtons.find(btn => btn.className.includes('bg-red'))
    expect(confirmButton).toBeDefined()
    await user.click(confirmButton!)

    await waitFor(() => {
      expect(onDiscardFile).toHaveBeenCalledWith('src/file2.tsx')
    })
  })

  it('shows busy state during discard operation', async () => {
    const user = userEvent.setup()
    let resolveDiscard: () => void
    const discardPromise = new Promise<void>((resolve) => {
      resolveDiscard = resolve
    })
    const onDiscardFile = vi.fn(() => discardPromise)
    const props = createMockProps({ onDiscardFile })

    render(<DiffViewer {...props} />)

    const discardButton = screen.getByLabelText('Discard src/file1.ts')
    await user.click(discardButton)

    await waitFor(() => {
      expect(screen.getByText('Discard File Changes')).toBeInTheDocument()
    })

    const confirmButtons = screen.getAllByRole('button', { name: /discard/i })
    const confirmButton = confirmButtons.find(btn => btn.className.includes('bg-red'))
    expect(confirmButton).toBeDefined()
    await user.click(confirmButton!)

    await waitFor(() => {
      expect(screen.getByLabelText('SCHALTWERK 3D assembled logo')).toBeInTheDocument()
    })

    resolveDiscard!()

    await waitFor(() => {
      expect(screen.queryByText('Discard File Changes')).not.toBeInTheDocument()
    })
  })
})
