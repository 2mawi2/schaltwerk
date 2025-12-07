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
    filePath: 'test-file.js',
    onLineMouseDown: vi.fn(),
    onLineMouseEnter: vi.fn(),
    onLineMouseLeave: vi.fn(),
    onLineMouseUp: vi.fn(),
    isHovered: false
  }

  const renderRow = (props = defaultProps) => {
    return render(
      <table>
        <tbody>
          <DiffLineRow {...props} />
        </tbody>
      </table>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call onLineMouseEnter with correct parameters', () => {
    const onLineMouseEnter = vi.fn()
    renderRow({ ...defaultProps, onLineMouseEnter })
    
    const row = screen.getByRole('row')
    fireEvent.mouseEnter(row)
    
    expect(onLineMouseEnter).toHaveBeenCalledWith({ lineNum: 42, side: 'new', filePath: 'test-file.js' })
  })

  it('should call onLineMouseLeave when mouse leaves', () => {
    const onLineMouseLeave = vi.fn()
    renderRow({ ...defaultProps, onLineMouseLeave })
    
    const row = screen.getByRole('row')
    fireEvent.mouseEnter(row)
    fireEvent.mouseLeave(row)
    
    expect(onLineMouseLeave).toHaveBeenCalledWith({ filePath: 'test-file.js' })
  })

  it('should have correct data attributes for DOM detection', () => {
    renderRow()
    
    const row = screen.getByRole('row')
    
    expect(row).toHaveAttribute('data-line-num', '42')
    expect(row).toHaveAttribute('data-side', 'new')
  })

  it('should show hover ring when isHovered prop is true', () => {
    renderRow({ ...defaultProps, isHovered: true })

    const row = screen.getByRole('row')

    expect(row).toHaveClass('ring-1', 'ring-cyan-300/50')
  })

  it('should not show hover ring when isHovered prop is false', () => {
    renderRow({ ...defaultProps, isHovered: false })

    const row = screen.getByRole('row')

    expect(row).not.toHaveClass('ring-1', 'ring-cyan-300/50')
  })

  it('should handle collapsible lines without showing hover hint', () => {
    const collapsibleLine: LineInfo = {
      type: 'unchanged',
      content: '',
      isCollapsible: true,
      collapsedCount: 10,
      collapsedLines: []
    }

    renderRow({ ...defaultProps, line: collapsibleLine })
    
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
    renderRow({ ...defaultProps, line: oldSideLine, onLineMouseEnter })
    
    const row = screen.getByRole('row')
    
    // Check data attributes
    expect(row).toHaveAttribute('data-line-num', '25')
    expect(row).toHaveAttribute('data-side', 'old')
    
    // Check mouse enter callback
    fireEvent.mouseEnter(row)
    expect(onLineMouseEnter).toHaveBeenCalledWith({ lineNum: 25, side: 'old', filePath: 'test-file.js' })
  })

  it('starts selection when row body is pressed', () => {
    const onLineMouseDown = vi.fn()

    renderRow({ ...defaultProps, onLineMouseDown })

    const code = screen.getByText('console.log("Hello world")')
    fireEvent.mouseDown(code, { button: 0 })

    expect(onLineMouseDown).toHaveBeenCalledWith({
      lineNum: 42,
      side: 'new',
      filePath: 'test-file.js',
      event: expect.any(Object)
    })
  })

  it('uses the new line number when selecting unchanged rows', () => {
    const line: LineInfo = {
      type: 'unchanged',
      content: 'unchanged example',
      oldLineNumber: 10,
      newLineNumber: 15
    }
    const onLineMouseDown = vi.fn()

    renderRow({ ...defaultProps, line, onLineMouseDown })

    const code = screen.getByText('unchanged example')
    fireEvent.mouseDown(code, { button: 0 })

    expect(onLineMouseDown).toHaveBeenCalledWith({
      lineNum: 15,
      side: 'new',
      filePath: 'test-file.js',
      event: expect.any(Object)
    })
  })
})
