import { VscTrash } from 'react-icons/vsc'
import type { CommentDisplay } from '../../hooks/useReviewComments'
import { useTranslation } from '../../common/i18n'

interface ReviewCommentsListProps {
  comments: CommentDisplay[]
  onDeleteComment: (_id: string) => void
}

export function ReviewCommentsList({ comments, onDeleteComment }: ReviewCommentsListProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {comments.map((comment) => (
        <div
          key={comment.id}
          className="group bg-slate-800/50 rounded px-2 py-1.5 hover:bg-slate-800"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-300 font-mono truncate">
                {comment.fileName}
              </div>
              <div className="text-[10px] text-slate-500">
                {comment.sideText ? `${comment.lineText} • ${comment.sideText}` : comment.lineText}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                "{comment.commentPreview}"
              </div>
            </div>
            <button
              onClick={() => onDeleteComment(comment.id)}
              className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400"
              title={t.reviewComments.deleteComment}
              aria-label={t.reviewComments.deleteCommentOn.replace('{file}', comment.fileName)}
            >
              <VscTrash className="text-xs" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
