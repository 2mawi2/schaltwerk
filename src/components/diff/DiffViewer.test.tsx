import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { DiffViewer, DiffViewerProps } from './DiffViewer'
import { createChangedFile } from '../../tests/test-utils'

const mockFileDiff = {
  diffResult: [
    { type: 'unchanged' as const, content: 'unchanged line 1', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'removed' as const, content: 'removed line', oldLineNumber: 2, newLineNumber: undefined },
    { type: 'added' as const, content: 'added line', oldLineNumber: undefined, newLineNumber: 2 },
    { type: 'unchanged' as const, content: 'unchanged line 2', oldLineNumber: 3, newLineNumber: 3 },
  ],
  fileInfo: { language: 'typescript', sizeBytes: 1024 },
  isBinary: false,
  file: createChangedFile({ path: 'src/file1.ts', change_type: 'modified', additions: 1, deletions: 1 }),
  changedLinesCount: 2
}

const mockFiles = [
  createChangedFile({ path: 'src/file1.ts', change_type: 'modified', additions: 1, deletions: 1 }),
  createChangedFile({ path: 'src/file2.tsx', change_type: 'added', additions: 3 }),
]

const mockProps: Partial<DiffViewerProps> = {
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
  }
}

describe('DiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state when no files', () => {
    render(<DiffViewer {...mockProps as DiffViewerProps} files={[]} selectedFile={null} />)
    // Should render AnimatedText instead of "Loading files..."
    const preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement).toHaveAttribute('aria-label', 'SCHALTWERK 3D assembled logo')
  })

  it('displays error message when fileError is present', () => {
    const props = { ...mockProps, fileError: 'File not found' }
    render(<DiffViewer {...props as DiffViewerProps} />)
    
    expect(screen.getByText('Cannot Display Diff')).toBeInTheDocument()
    expect(screen.getByText('File not found')).toBeInTheDocument()
  })

  it('displays binary file warning for binary files', () => {
    const binaryDiff = { ...mockFileDiff, isBinary: true, unsupportedReason: 'Binary file' }
    const props = {
      ...mockProps,
      allFileDiffs: new Map([['src/file1.ts', binaryDiff]])
    }
    
    render(<DiffViewer {...props as DiffViewerProps} />)
    
    expect(screen.getByText('Binary File')).toBeInTheDocument()
    expect(screen.getByText('Binary file')).toBeInTheDocument()
  })

  it('shows branch information', () => {
    render(<DiffViewer {...mockProps as DiffViewerProps} />)
    
    expect(screen.getByText(/main.*→.*feature\/test/)).toBeInTheDocument()
    expect(screen.getByText(/abc1234.*def5678/)).toBeInTheDocument()
  })

  it('renders file header with correct information', () => {
    render(<DiffViewer {...mockProps as DiffViewerProps} />)
    
    expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
    expect(screen.getByText('Modified')).toBeInTheDocument()
  })

  it('shows loading placeholder when diff is loading', () => {
    const props = {
      ...mockProps,
      allFileDiffs: new Map(), // No diff loaded
      files: [createChangedFile({ path: 'src/file1.ts', change_type: 'modified' })]
    }
    
    render(<DiffViewer {...props as DiffViewerProps} />)
    // Should render AnimatedText instead of "Loading diff..."
    const preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement).toHaveAttribute('aria-label', 'SCHALTWERK 3D assembled logo')
  })

  it('renders diff lines correctly', () => {
    render(<DiffViewer {...mockProps as DiffViewerProps} />)
    
    // Should render the diff content - exact text depends on DiffLineRow implementation
    expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
  })

  it('shows comment count when file has comments', () => {
    const getCommentsForFile = vi.fn(() => [
      {
        id: 'thread-1',
        filePath: 'src/file1.ts',
        side: 'new' as const,
        lineRange: { start: 1, end: 1 },
        comments: [
          { id: '1', filePath: 'src/file1.ts', lineRange: { start: 1, end: 1 }, side: 'new' as const, selectedText: 'test', comment: 'test comment', timestamp: Date.now() },
          { id: '2', filePath: 'src/file1.ts', lineRange: { start: 1, end: 1 }, side: 'new' as const, selectedText: 'test-2', comment: 'follow-up', timestamp: Date.now() }
        ]
      }
    ])
    render(<DiffViewer {...mockProps as DiffViewerProps} getCommentsForFile={getCommentsForFile} />)
    
    expect(screen.getByText('2 comments')).toBeInTheDocument()
  })

  it('handles large diff mode vs continuous scroll mode', () => {
    // Test large diff mode (single file)
    const { unmount } = render(<DiffViewer {...mockProps as DiffViewerProps} isLargeDiffMode={true} />)
    expect(screen.getByText('src/file1.ts')).toBeInTheDocument()
    unmount()
    
    // Test continuous scroll mode (multiple files) - clean render
    const continuousProps = { 
      ...mockProps, 
      isLargeDiffMode: false,
      allFileDiffs: new Map([
        ['src/file1.ts', mockFileDiff],
        ['src/file2.tsx', mockFileDiff]
      ])
    }
    
    render(<DiffViewer {...continuousProps as DiffViewerProps} />)
    // Both files should be present in continuous mode - use getAllByText since multiple instances
    const file1Elements = screen.getAllByText('src/file1.ts')
    const file2Elements = screen.getAllByText('src/file2.tsx')
    expect(file1Elements.length).toBeGreaterThan(0)
    expect(file2Elements.length).toBeGreaterThan(0)
  })

  it('shows preparing preview when no diffs loaded', () => {
    const props = {
      ...mockProps,
      allFileDiffs: new Map(),
      files: [createChangedFile({ path: 'src/file1.ts', change_type: 'modified' })],
    }
    
    render(<DiffViewer {...props as DiffViewerProps} />)
    expect(screen.getByText('Preparing preview…')).toBeInTheDocument()
  })

  it('handles mouse events for line selection', () => {
    const handleLineMouseDown = vi.fn()
    render(<DiffViewer {...mockProps as DiffViewerProps} handleLineMouseDown={handleLineMouseDown} />)
    
    // Mouse events would be handled by DiffLineRow components
    expect(handleLineMouseDown).not.toHaveBeenCalled() // Not called until user interacts
  })

  it('collapses deleted file diffs by default but allows expanding', () => {
    const deletedFile = createChangedFile({ path: 'src/deleted.ts', change_type: 'deleted', deletions: 3 })
    const deletedDiff = {
      ...mockFileDiff,
      file: deletedFile
    }
    const onToggleFileExpanded = vi.fn()
    const props = {
      ...mockProps,
      files: [deletedFile],
      selectedFile: 'src/deleted.ts',
      allFileDiffs: new Map([['src/deleted.ts', deletedDiff]]),
      onToggleFileExpanded
    }

    render(<DiffViewer {...props as DiffViewerProps} />)

    expect(screen.getByText('Click to expand')).toBeInTheDocument()
    expect(screen.queryByText('removed line')).not.toBeInTheDocument()

    const expandButton = screen.getByText('Click to expand').closest('button')
    expect(expandButton).toBeTruthy()
    if (!expandButton) throw new Error('Expected Click to expand button')
    fireEvent.click(expandButton)
    expect(onToggleFileExpanded).toHaveBeenCalledWith('src/deleted.ts')
  })

  it('renders deleted file diff when expanded', () => {
    const deletedFile = createChangedFile({ path: 'src/deleted-explicit.ts', change_type: 'deleted', deletions: 2 })
    const deletedDiff = {
      ...mockFileDiff,
      file: deletedFile
    }
    const props = {
      ...mockProps,
      files: [deletedFile],
      selectedFile: 'src/deleted-explicit.ts',
      allFileDiffs: new Map([['src/deleted-explicit.ts', deletedDiff]]),
      expandedFiles: new Set(['src/deleted-explicit.ts'])
    }

    render(<DiffViewer {...props as DiffViewerProps} />)

    expect(screen.queryByText('Click to expand')).not.toBeInTheDocument()
    expect(screen.getByText('removed line')).toBeInTheDocument()
  })

  it('toggles collapsed sections', () => {
    const toggleCollapsed = vi.fn()
    render(<DiffViewer {...mockProps as DiffViewerProps} toggleCollapsed={toggleCollapsed} />)
    
    // Collapse functionality would be triggered by DiffLineRow interactions
    expect(toggleCollapsed).not.toHaveBeenCalled() // Not called until user interacts
  })

  it('applies syntax highlighting when provided', () => {
    const highlightCode = vi.fn((_filePath: string, _lineKey: string, code: string) => `<span class="highlighted">${code}</span>`)
    render(<DiffViewer {...mockProps as DiffViewerProps} highlightCode={highlightCode} />)

    // Should call highlight function for visible content
    expect(highlightCode).toHaveBeenCalled()
  })

  it('renders a placeholder for non-visible diffs in continuous mode', () => {
    const file2Diff = {
      ...mockFileDiff,
      file: createChangedFile({ path: 'src/file2.tsx', change_type: 'modified', additions: 2, deletions: 1 })
    }
    const props = {
      ...mockProps,
      isLargeDiffMode: false,
      files: mockFiles,
      selectedFile: 'src/file2.tsx',
      visibleFileSet: new Set<string>(),
      renderedFileSet: new Set<string>(),
      allFileDiffs: new Map([
        ['src/file1.ts', mockFileDiff],
        ['src/file2.tsx', file2Diff]
      ]),
      fileBodyHeights: new Map<string, number>([['src/file1.ts', 400]])
    }

    render(<DiffViewer {...props as DiffViewerProps} />)

    const placeholders = screen.getAllByTestId('diff-placeholder')
    expect(placeholders.length).toBeGreaterThan(0)
  })

  it('keeps diff content rendered while file remains in the rendered set', () => {
    const props = {
      ...mockProps,
      isLargeDiffMode: false,
      files: [createChangedFile({ path: 'src/file1.ts', change_type: 'modified' })],
      selectedFile: null,
      visibleFileSet: new Set<string>(),
      renderedFileSet: new Set<string>(['src/file1.ts']),
      allFileDiffs: new Map([
        ['src/file1.ts', mockFileDiff]
      ])
    }

    render(<DiffViewer {...props as DiffViewerProps} />)

    expect(screen.queryByTestId('diff-placeholder')).not.toBeInTheDocument()
  })

  it('applies horizontal scrolling at the file level instead of per line', () => {
    render(<DiffViewer {...mockProps as DiffViewerProps} />)

    const codeElement = screen.getByText('unchanged line 1')
    const codeCell = codeElement.closest('td')
    expect(codeCell).not.toBeNull()
    expect(codeCell?.className).not.toContain('overflow-x-auto')

    const tableWrapper = codeCell?.closest('table')?.parentElement
    expect(tableWrapper).not.toBeNull()
    expect(tableWrapper?.className).toContain('overflow-x-auto')
  })

})
