import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReviewCommentsList } from './ReviewCommentsList'
import { ReviewComment } from '../../types/review'

describe('ReviewCommentsList', () => {
  const createMockComment = (overrides?: Partial<ReviewComment>): ReviewComment => ({
    id: '1',
    filePath: 'src/components/Example.tsx',
    lineRange: { start: 10, end: 15 },
    side: 'new',
    selectedText: 'const example = true',
    comment: 'This is a test comment',
    timestamp: Date.now(),
    ...overrides
  })

  it('should render comments list', () => {
    const comments = [
      createMockComment({ id: '1', comment: 'First comment' }),
      createMockComment({ id: '2', comment: 'Second comment', filePath: 'src/utils/helper.ts' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText('Example.tsx')).toBeInTheDocument()
    expect(screen.getByText('helper.ts')).toBeInTheDocument()
    expect(screen.getByText('"First comment"')).toBeInTheDocument()
    expect(screen.getByText('"Second comment"')).toBeInTheDocument()
  })

  it('should display line ranges correctly', () => {
    const comments = [
      createMockComment({ lineRange: { start: 10, end: 15 } }),
      createMockComment({ id: '2', lineRange: { start: 20, end: 20 } })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText(/Lines 10-15/)).toBeInTheDocument()
    expect(screen.getByText(/Line 20/)).toBeInTheDocument()
  })

  it('should display side correctly', () => {
    const comments = [
      createMockComment({ side: 'old' }),
      createMockComment({ id: '2', side: 'new' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText(/base/)).toBeInTheDocument()
    expect(screen.getByText(/current/)).toBeInTheDocument()
  })

  it('should truncate long comments', () => {
    const longComment = 'This is a very long comment that should be truncated in the preview to keep the UI clean and readable'
    const comments = [
      createMockComment({ comment: longComment })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText('"This is a very long comment that should be truncat..."')).toBeInTheDocument()
    expect(screen.queryByText(longComment)).not.toBeInTheDocument()
  })

  it('should call onDeleteComment when delete button is clicked', () => {
    const comments = [
      createMockComment({ id: 'comment-1' }),
      createMockComment({ id: 'comment-2' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    const deleteButtons = screen.getAllByLabelText(/Delete comment/)
    fireEvent.click(deleteButtons[0])

    expect(onDelete).toHaveBeenCalledWith('comment-1')
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('should render empty list when no comments', () => {
    const onDelete = vi.fn()

    const { container } = render(<ReviewCommentsList comments={[]} onDeleteComment={onDelete} />)

    expect(container.querySelector('.space-y-2')).toBeEmptyDOMElement()
  })

  it('should have proper accessibility attributes', () => {
    const comments = [
      createMockComment({ filePath: 'src/App.tsx' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    const deleteButton = screen.getByLabelText('Delete comment on App.tsx')
    expect(deleteButton).toHaveAttribute('title', 'Delete comment')
  })
})