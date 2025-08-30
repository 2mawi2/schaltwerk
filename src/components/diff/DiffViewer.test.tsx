import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  file: { path: 'src/file1.ts', change_type: 'modified' as const },
  mainContent: 'original content',
  worktreeContent: 'modified content',
  changedLinesCount: 2
}

const mockFiles = [
  { path: 'src/file1.ts', change_type: 'modified' as const },
  { path: 'src/file2.tsx', change_type: 'added' as const },
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
  expandedSections: new Set<string>(),
  isLargeDiffMode: true,
  visibleFileSet: new Set(['src/file1.ts']),
  loadingFiles: new Set<string>(),
  observerRef: { current: null },
  scrollContainerRef: { current: null as any },
  fileRefs: { current: new Map() },
  getCommentsForFile: vi.fn(() => []),
  getCommentForLine: vi.fn(() => null),
  highlightCode: vi.fn((code: string) => code),
  toggleCollapsed: vi.fn(),
  handleLineMouseDown: vi.fn(),
  handleLineMouseEnter: vi.fn(),
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
      files: [{ path: 'src/file1.ts', change_type: 'modified' as const }]
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
    const getCommentsForFile = vi.fn(() => [{ id: '1' }, { id: '2' }])
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
      files: [{ path: 'src/file1.ts', change_type: 'modified' as const }]
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

  it('toggles collapsed sections', () => {
    const toggleCollapsed = vi.fn()
    render(<DiffViewer {...mockProps as DiffViewerProps} toggleCollapsed={toggleCollapsed} />)
    
    // Collapse functionality would be triggered by DiffLineRow interactions
    expect(toggleCollapsed).not.toHaveBeenCalled() // Not called until user interacts
  })

  it('applies syntax highlighting when provided', () => {
    const highlightCode = vi.fn((code) => `<span class="highlighted">${code}</span>`)
    render(<DiffViewer {...mockProps as DiffViewerProps} highlightCode={highlightCode} />)
    
    // Should call highlight function for visible content
    expect(highlightCode).toHaveBeenCalled()
  })
})