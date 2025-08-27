import clsx from 'clsx'
import { VscComment, VscCheck } from 'react-icons/vsc'
import { getFileIcon } from '../../utils/fileIcons'
import { ReviewCommentsList } from './ReviewCommentsList'

export interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

export interface DiffFileExplorerProps {
  files: ChangedFile[]
  selectedFile: string | null
  visibleFilePath: string | null
  onFileSelect: (filePath: string, index: number) => void
  getCommentsForFile: (filePath: string) => any[]
  currentReview: { 
    sessionName: string
    comments: any[] 
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
  getConfirmationMessage = (count: number) => `Are you sure you want to cancel this review? You will lose ${count} comment${count > 1 ? 's' : ''}.`
}: DiffFileExplorerProps) {
  return (
    <div className="w-80 border-r border-slate-800 bg-slate-900/30 flex flex-col animate-slideIn">
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
                "px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors",
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
                <div className="flex items-center gap-1 text-xs text-blue-400">
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
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
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
              onClick={() => {
                if (window.confirm(getConfirmationMessage(currentReview.comments.length))) {
                  onCancelReview()
                }
              }}
              className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors text-slate-400 hover:text-slate-300"
            >
              Cancel Review
            </button>
          </div>
        </div>
      )}
    </div>
  )
}