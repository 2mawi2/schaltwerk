import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReviewCommentsList } from './ReviewCommentsList'
import type { CommentDisplay } from '../../hooks/useReviewComments'

describe('ReviewCommentsList', () => {
  const createMockDisplayComment = (overrides?: Partial<CommentDisplay>): CommentDisplay => ({
    id: '1',
    fileName: 'Example.tsx',
    lineText: 'Lines 10-15',
    sideText: 'current',
    commentPreview: 'This is a test comment',
    fullComment: 'This is a test comment',
    filePath: 'src/components/Example.tsx',
    lineRange: { start: 10, end: 15 },
    side: 'new',
    ...overrides
  })

  it('should render comments list', () => {
    const comments = [
      createMockDisplayComment({ id: '1', commentPreview: 'First comment' }),
      createMockDisplayComment({ id: '2', commentPreview: 'Second comment', fileName: 'helper.ts' })
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
      createMockDisplayComment({ lineText: 'Lines 10-15' }),
      createMockDisplayComment({ id: '2', lineText: 'Line 20' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText(/Lines 10-15/)).toBeInTheDocument()
    expect(screen.getByText(/Line 20/)).toBeInTheDocument()
  })

  it('should display side when provided', () => {
    const comments = [
      createMockDisplayComment({ sideText: 'base' }),
      createMockDisplayComment({ id: '2', sideText: 'current' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText(/base/)).toBeInTheDocument()
    expect(screen.getByText(/current/)).toBeInTheDocument()
  })

  it('should hide side text separator when sideText is not provided', () => {
    const comments = [
      createMockDisplayComment({ sideText: undefined, lineText: 'Lines 5-10' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText('Lines 5-10')).toBeInTheDocument()
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('should render truncated comment preview', () => {
    const comments = [
      createMockDisplayComment({ commentPreview: 'This is a very long comment that should be truncat...' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    expect(screen.getByText('"This is a very long comment that should be truncat..."')).toBeInTheDocument()
  })

  it('should call onDeleteComment when delete button is clicked', () => {
    const comments = [
      createMockDisplayComment({ id: 'comment-1' }),
      createMockDisplayComment({ id: 'comment-2' })
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
      createMockDisplayComment({ fileName: 'App.tsx' })
    ]
    const onDelete = vi.fn()

    render(<ReviewCommentsList comments={comments} onDeleteComment={onDelete} />)

    const deleteButton = screen.getByLabelText('Delete comment on App.tsx')
    expect(deleteButton).toHaveAttribute('title', 'Delete comment')
  })
})
