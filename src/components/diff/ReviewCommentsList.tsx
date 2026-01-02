import { VscTrash } from 'react-icons/vsc'
import type { CommentDisplay } from '../../hooks/useReviewComments'

interface ReviewCommentsListProps {
  comments: CommentDisplay[]
  onDeleteComment: (_id: string) => void
}

export function ReviewCommentsList({ comments, onDeleteComment }: ReviewCommentsListProps) {
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="group rounded px-2 py-1.5"
          style={{ backgroundColor: 'var(--color-bg-elevated)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono truncate" style={{ color: 'var(--color-text-primary)' }}>
                {comment.fileName}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                {comment.sideText ? `${comment.lineText} • ${comment.sideText}` : comment.lineText}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                "{comment.commentPreview}"
              </div>
            </div>
            <button
              onClick={() => onDeleteComment(comment.id)}
              className="opacity-0 group-hover:opacity-100 p-1"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-red)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
              title="Delete comment"
              aria-label={`Delete comment on ${comment.fileName}`}
            >
              <VscTrash className="text-xs" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
