import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffLineRow } from './DiffLineRow'
import type { LineInfo } from '../../types/diff'

describe('DiffLineRow hover functionality', () => {
  const mockLine: LineInfo = {
    type: 'added',
    content: 'console.log("Hello world")',
    newLineNumber: 42,
    oldLineNumber: undefined
  }

  const defaultProps = {
    line: mockLine,
    index: 'test-line',
    isSelected: false,
    onLineMouseDown: vi.fn(),
    onLineMouseEnter: vi.fn(),
    onLineMouseLeave: vi.fn(),
    onLineMouseUp: vi.fn(),
    filePath: 'test-file.js'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show hover hint when hovered', () => {
    render(<DiffLineRow {...defaultProps} />)
    
    const row = screen.getByRole('row')
    
    // Should not show hint initially
    expect(screen.queryByText('Press Enter to comment')).not.toBeInTheDocument()
    
    // Hover over the row
    fireEvent.mouseEnter(row)
    
    // Should show the hint
    expect(screen.getByText('Press Enter to comment')).toBeInTheDocument()
  })

  it('should hide hover hint when mouse leaves', () => {
    render(<DiffLineRow {...defaultProps} />)
    
    const row = screen.getByRole('row')
    
    // Hover and check hint appears
    fireEvent.mouseEnter(row)
    expect(screen.getByText('Press Enter to comment')).toBeInTheDocument()
    
    // Mouse leave
    fireEvent.mouseLeave(row)
    
    // Hint should be gone
    expect(screen.queryByText('Press Enter to comment')).not.toBeInTheDocument()
  })

  it('should call onLineMouseEnter with correct parameters', () => {
    const onLineMouseEnter = vi.fn()
    render(<DiffLineRow {...defaultProps} onLineMouseEnter={onLineMouseEnter} />)
    
    const row = screen.getByRole('row')
    fireEvent.mouseEnter(row)
    
    expect(onLineMouseEnter).toHaveBeenCalledWith(42, 'new')
  })

  it('should call onLineMouseLeave when mouse leaves', () => {
    const onLineMouseLeave = vi.fn()
    render(<DiffLineRow {...defaultProps} onLineMouseLeave={onLineMouseLeave} />)
    
    const row = screen.getByRole('row')
    fireEvent.mouseEnter(row)
    fireEvent.mouseLeave(row)
    
    expect(onLineMouseLeave).toHaveBeenCalled()
  })

  it('should have correct data attributes for DOM detection', () => {
    render(<DiffLineRow {...defaultProps} />)
    
    const row = screen.getByRole('row')
    
    expect(row).toHaveAttribute('data-line-num', '42')
    expect(row).toHaveAttribute('data-side', 'new')
  })

  it('should show hover ring when hovered', () => {
    render(<DiffLineRow {...defaultProps} />)
    
    const row = screen.getByRole('row')
    
    // Initially no hover ring
    expect(row).not.toHaveClass('ring-1', 'ring-cyan-300/50')

    // Hover
    fireEvent.mouseEnter(row)

    // Should have hover ring
    expect(row).toHaveClass('ring-1', 'ring-cyan-300/50')
  })

  it('should handle collapsible lines without showing hover hint', () => {
    const collapsibleLine: LineInfo = {
      type: 'unchanged',
      content: '',
      isCollapsible: true,
      collapsedCount: 10,
      collapsedLines: []
    }

    render(<DiffLineRow {...defaultProps} line={collapsibleLine} />)
    
    const row = screen.getByRole('row')
    fireEvent.mouseEnter(row)
    
    // Collapsible lines should not show the comment hint
    expect(screen.queryByText('Press Enter to comment')).not.toBeInTheDocument()
  })

  it('should work for old side lines', () => {
    const oldSideLine: LineInfo = {
      type: 'removed',
      content: 'old code here',
      newLineNumber: undefined,
      oldLineNumber: 25
    }

    const onLineMouseEnter = vi.fn()
    render(<DiffLineRow {...defaultProps} line={oldSideLine} onLineMouseEnter={onLineMouseEnter} />)
    
    const row = screen.getByRole('row')
    
    // Check data attributes
    expect(row).toHaveAttribute('data-line-num', '25')
    expect(row).toHaveAttribute('data-side', 'old')
    
    // Check mouse enter callback
    fireEvent.mouseEnter(row)
    expect(onLineMouseEnter).toHaveBeenCalledWith(25, 'old')
  })

  it('should not interfere with existing comment display', () => {
    render(
      <DiffLineRow 
        {...defaultProps} 
        hasComment={true}
        commentText="Existing comment here"
      />
    )
    
    const row = screen.getByRole('row')
    
    // Should show existing comment
    expect(screen.getByText('Comment')).toBeInTheDocument()
    
    // Hover to show hint
    fireEvent.mouseEnter(row)
    
    // Both should be visible
    expect(screen.getByText('Comment')).toBeInTheDocument()
    expect(screen.getByText('Press Enter to comment')).toBeInTheDocument()
  })
})