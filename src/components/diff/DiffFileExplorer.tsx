import { useState } from 'react'
import clsx from 'clsx'
import { VscComment, VscCheck } from 'react-icons/vsc'
import { getFileIcon } from '../../utils/fileIcons'
import { ReviewCommentsList } from './ReviewCommentsList'
import { ReviewComment } from '../../types/review'
import { theme } from '../../common/theme'
import { ConfirmModal } from '../modals/ConfirmModal'

export interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

export interface DiffFileExplorerProps {
  files: ChangedFile[]
  selectedFile: string | null
  visibleFilePath: string | null
  onFileSelect: (filePath: string, index: number) => void
  getCommentsForFile: (filePath: string) => ReviewComment[]
  currentReview: {
    sessionName: string
    comments: ReviewComment[]
  } | null
  onFinishReview: () => void
  onCancelReview: () => void
  removeComment: (commentId: string) => void
  getConfirmationMessage?: (count: number) => string
}


export function DiffFileExplorer({
  files,
  selectedFile,
  visibleFilePath,
  onFileSelect,
  getCommentsForFile,
  currentReview,
  onFinishReview,
  onCancelReview,
  removeComment,
  getConfirmationMessage = (count: number) => `Cancel review and discard ${count} comment${count > 1 ? 's' : ''}?`
}: DiffFileExplorerProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  return (
    <div
      className="border-r border-slate-800 bg-slate-900/30 flex flex-col h-full"
      style={{ width: '100%' }}
    >
      <div className="p-3 border-b border-slate-800">
        <div className="text-sm font-medium mb-1">Changed Files</div>
        <div className="text-xs text-slate-500">{files.length} files</div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {files.map((file, index) => {
          const commentCount = getCommentsForFile(file.path).length
          const isLeftSelected = (visibleFilePath ?? selectedFile) === file.path
          return (
            <div
              key={file.path}
              className={clsx(
                "px-3 py-2 cursor-pointer hover:bg-slate-800/50",
                "flex items-center gap-2",
                isLeftSelected && "bg-slate-800"
              )}
              onClick={() => onFileSelect(file.path, index)}
            >
              {getFileIcon(file.change_type, file.path)}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{file.path.split('/').pop()}</div>
                <div className="text-xs text-slate-500 truncate">
                  {file.path.substring(0, file.path.lastIndexOf('/')) || ''}
                </div>
              </div>
               {commentCount > 0 && (
                 <div className={`flex items-center gap-1 text-xs ${theme.colors.accent.blue.DEFAULT}`}>
                   <VscComment />
                   <span>{commentCount}</span>
                 </div>
               )}
            </div>
          )
        })}
      </div>
      
      {currentReview && currentReview.comments.length > 0 && (
        <div className="p-3 border-t border-slate-800 flex flex-col gap-3">
          <div className="text-xs text-slate-500">
            <div className="font-medium text-slate-400 mb-2">Review Comments:</div>
            <ReviewCommentsList 
              comments={currentReview.comments}
              onDeleteComment={removeComment}
            />
          </div>
          <div className="space-y-2">
            <button
              onClick={onFinishReview}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              style={{
                backgroundColor: theme.colors.accent.blue.DEFAULT,
                color: theme.colors.text.inverse,
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT
              }}
            >
              <VscCheck />
              <span>
                Finish Review ({currentReview.comments.length} comment{currentReview.comments.length > 1 ? 's' : ''})
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                ⌘↩
              </span>
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-300"
            >
              Cancel Review
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel Review"
        body={
          <p className="text-sm text-slate-300">
            {currentReview ? getConfirmationMessage(currentReview.comments.length) : 'Cancel review?'}
          </p>
        }
        confirmText="Discard Comments"
        cancelText="Keep Review"
        onConfirm={() => {
          setShowCancelConfirm(false)
          onCancelReview()
        }}
        onCancel={() => setShowCancelConfirm(false)}
        variant="danger"
      />
    </div>
  )
}
