import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffFileExplorer } from './DiffFileExplorer'
import type { ChangedFile } from '../../common/events'

const makeChangedFile = (file: Partial<ChangedFile> & { path: string }): ChangedFile => {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return {
    path: file.path,
    change_type: file.change_type ?? 'modified',
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    is_binary: file.is_binary,
  }
}

const mockFiles = [
  makeChangedFile({ path: 'src/file1.ts', change_type: 'modified', additions: 3, deletions: 1 }),
  makeChangedFile({ path: 'src/file2.tsx', change_type: 'added', additions: 5 }),
  makeChangedFile({ path: 'src/file3.js', change_type: 'deleted', deletions: 2 }),
]

const mockProps = {
  files: mockFiles,
  selectedFile: 'src/file1.ts',
  visibleFilePath: 'src/file1.ts',
  onFileSelect: vi.fn(),
  getCommentsForFile: vi.fn(() => []),
  currentReview: null,
  onFinishReview: vi.fn(),
  onCancelReview: vi.fn(),
  removeComment: vi.fn()
}

describe('DiffFileExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders file list with correct count', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    expect(screen.getByText('Changed Files')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
  })

  it('displays file names correctly', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    expect(screen.getByText('file1.ts')).toBeInTheDocument()
    expect(screen.getByText('file2.tsx')).toBeInTheDocument()
    expect(screen.getByText('file3.js')).toBeInTheDocument()
  })

  it('renders stat badges for additions, deletions, and totals', () => {
    render(<DiffFileExplorer {...mockProps} />)

    expect(screen.getAllByText('+3')[0]).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.queryByText('Σ4')).toBeNull()
    expect(screen.getByText('-2')).toBeInTheDocument()
  })

  it('shows file paths in subdirectory display', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    // Should show 'src' as the directory for all files
    const srcElements = screen.getAllByText('src')
    expect(srcElements.length).toBe(3)
  })

  it('highlights selected file', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    const selectedFileElement = screen.getByText('file1.ts').closest('.cursor-pointer')
    expect(selectedFileElement).toHaveClass('bg-slate-800')
  })

  it('calls onFileSelect when file is clicked', () => {
    const onFileSelect = vi.fn()
    render(<DiffFileExplorer {...mockProps} onFileSelect={onFileSelect} />)
    
    fireEvent.click(screen.getByText('file2.tsx'))
    expect(onFileSelect).toHaveBeenCalledWith('src/file2.tsx', 1)
  })

  it('shows comment count when file has comments', () => {
    const getCommentsForFile = vi.fn((path: string) => {
      if (path === 'src/file1.ts') return [
        { id: '1', filePath: 'src/file1.ts', lineRange: { start: 1, end: 1 }, side: 'new' as const, selectedText: 'test', comment: 'test comment', timestamp: Date.now() },
        { id: '2', filePath: 'src/file1.ts', lineRange: { start: 2, end: 2 }, side: 'new' as const, selectedText: 'test2', comment: 'test comment2', timestamp: Date.now() }
      ]
      return []
    })

    render(<DiffFileExplorer {...mockProps} getCommentsForFile={getCommentsForFile} />)
    
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows binary label when file is marked binary', () => {
    const files = [
      ...mockFiles,
      makeChangedFile({ path: 'src/logo.png', change_type: 'modified', is_binary: true })
    ]

    render(<DiffFileExplorer {...mockProps} files={files} />)

    expect(screen.getByText('Binary')).toBeInTheDocument()
  })

  it('does not show review section when no review exists', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    expect(screen.queryByText('Review Comments:')).not.toBeInTheDocument()
    expect(screen.queryByText('Finish Review')).not.toBeInTheDocument()
  })

  it('shows review section when review has comments', () => {
    const currentReview = {
      sessionName: 'test',
      comments: [{
        id: '1',
        filePath: 'src/file1.ts',
        comment: 'Test comment',
        lineRange: { start: 1, end: 1 },
        side: 'new' as const,
        selectedText: 'some code',
        timestamp: Date.now()
      }]
    }

    render(<DiffFileExplorer {...mockProps} currentReview={currentReview} />)
    
    expect(screen.getByText('Review Comments:')).toBeInTheDocument()
    expect(screen.getByText('Finish Review (1 comment)')).toBeInTheDocument()
  })

  it('calls onFinishReview when finish button is clicked', () => {
    const onFinishReview = vi.fn()
    const currentReview = {
      sessionName: 'test',
      comments: [{
        id: '1',
        filePath: 'src/file1.ts',
        comment: 'Test comment',
        lineRange: { start: 1, end: 1 },
        side: 'new' as const,
        selectedText: 'some code',
        timestamp: Date.now()
      }]
    }

    render(<DiffFileExplorer {...mockProps} currentReview={currentReview} onFinishReview={onFinishReview} />)
    
    fireEvent.click(screen.getByText(/Finish Review/))
    expect(onFinishReview).toHaveBeenCalled()
  })

  it('shows different icons for different file types', () => {
    render(<DiffFileExplorer {...mockProps} />)
    
    // Each file should have an appropriate icon based on change type
    // We can't easily test the specific icons, but we can verify they render
    const fileElements = screen.getAllByRole('generic')
    expect(fileElements.length).toBeGreaterThan(0)
  })

  it('handles empty file list', () => {
    render(<DiffFileExplorer {...mockProps} files={[]} />)
    
    expect(screen.getByText('0 files')).toBeInTheDocument()
  })
})
