import { useState, useMemo } from 'react'
import clsx from 'clsx'
import { VscComment, VscCheck } from 'react-icons/vsc'
import { getFileIcon } from '../../utils/fileIcons'
import { ReviewCommentsList } from './ReviewCommentsList'
import { ReviewComment } from '../../types/review'
import { useReviewComments } from '../../hooks/useReviewComments'
import { ConfirmModal } from '../modals/ConfirmModal'
import type { ChangedFile as EventsChangedFile } from '../../common/events'
import { DiffChangeBadges } from './DiffChangeBadges'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'
import { FileTree } from './FileTree'
import type { FileNode } from '../../utils/folderTree'

export type ChangedFile = EventsChangedFile

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
  const { formatCommentsForDisplay } = useReviewComments()

  const displayComments = useMemo(() => {
    if (!currentReview) return []
    return formatCommentsForDisplay(currentReview.comments)
  }, [currentReview, formatCommentsForDisplay])

  const fileIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    files.forEach((file, index) => {
      map.set(file.path, index)
    })
    return map
  }, [files])

  const renderFileNode = (node: FileNode, depth: number) => {
    const fileIndex = fileIndexMap.get(node.file.path) ?? -1
    const commentCount = getCommentsForFile(node.file.path).length
    const isLeftSelected = (visibleFilePath ?? selectedFile) === node.file.path
    const additions = node.file.additions ?? 0
    const deletions = node.file.deletions ?? 0
    const changes = node.file.changes ?? additions + deletions
    const isBinary = node.file.is_binary ?? (node.file.change_type !== 'deleted' && isBinaryFileByExtension(node.file.path))

    return (
      <div
        key={node.path}
        className={clsx(
          'cursor-pointer hover:bg-slate-800/50 flex items-center gap-2',
          isLeftSelected && "bg-slate-800"
        )}
        style={{ paddingLeft: `${depth * 12 + 12}px`, paddingTop: '4px', paddingBottom: '4px' }}
        onClick={() => onFileSelect(node.file.path, fileIndex)}
      >
        {getFileIcon(node.file.change_type, node.file.path)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 justify-between">
            <div className="text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
              {node.name}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <DiffChangeBadges
                additions={additions}
                deletions={deletions}
                changes={changes}
                isBinary={isBinary}
                layout="row"
                size="compact"
              />
              {commentCount > 0 && (
                <div
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{ color: 'var(--color-accent-blue-light)' }}
                >
                  <VscComment size={12} />
                  <span>{commentCount}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="border-r border-slate-800 bg-slate-900/30 flex flex-col h-full"
      style={{ width: '100%' }}
    >
      <div className="p-3 border-b border-slate-800">
        <div className="text-sm font-medium mb-1">Changed Files</div>
        <div className="text-xs text-slate-500">{files.length} files</div>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <FileTree files={files} renderFileNode={renderFileNode} />
      </div>
      
      {currentReview && currentReview.comments.length > 0 && (
        <div className="p-3 border-t border-slate-800 flex flex-col gap-3">
          <div className="text-xs text-slate-500">
            <div className="font-medium text-slate-400 mb-2">Review Comments:</div>
            <ReviewCommentsList
              comments={displayComments}
              onDeleteComment={removeComment}
            />
          </div>
          <div className="space-y-2">
            <button
              onClick={onFinishReview}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              style={{
                backgroundColor: 'var(--color-accent-blue)',
                color: 'var(--color-text-inverse)',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)'
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
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
