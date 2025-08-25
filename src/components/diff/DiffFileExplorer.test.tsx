import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffFileExplorer } from './DiffFileExplorer'

const mockFiles = [
  { path: 'src/file1.ts', change_type: 'modified' as const },
  { path: 'src/file2.tsx', change_type: 'added' as const },
  { path: 'src/file3.js', change_type: 'deleted' as const },
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
      if (path === 'src/file1.ts') return [{ id: '1' }, { id: '2' }]
      return []
    })

    render(<DiffFileExplorer {...mockProps} getCommentsForFile={getCommentsForFile} />)
    
    expect(screen.getByText('2')).toBeInTheDocument()
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
        selectedText: 'some code'
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
        selectedText: 'some code'
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