import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../../common/theme'
import { useModal } from '../../contexts/ModalContext'
import { LoadingSpinner } from '../common/LoadingSpinner'

export type MergeModeOption = 'squash' | 'reapply'

interface MergePreviewResponse {
  sessionBranch: string
  parentBranch: string
  squashCommands: string[]
  reapplyCommands: string[]
  defaultCommitMessage: string
  hasConflicts: boolean
  conflictingPaths: string[]
  isUpToDate: boolean
}

interface MergeSessionModalProps {
  open: boolean
  sessionName: string | null
  status: 'idle' | 'loading' | 'ready' | 'running'
  preview: MergePreviewResponse | null
  error?: string | null
  onClose: () => void
  onConfirm: (mode: MergeModeOption, commitMessage?: string) => void
  cachedCommitMessage?: string
  onCommitMessageChange?: (value: string) => void
  autoCancelEnabled: boolean
  onToggleAutoCancel: (next: boolean) => void
}

const modalBackdropStyle: React.CSSProperties = {
  backgroundColor: theme.colors.overlay.backdrop,
}

const modalContainerStyle: React.CSSProperties = {
  backgroundColor: theme.colors.background.elevated,
  border: `1px solid ${theme.colors.border.subtle}`,
  color: theme.colors.text.primary,
}

const fieldLabelStyle: React.CSSProperties = {
  color: theme.colors.text.secondary,
  fontSize: theme.fontSize?.label || '0.75rem',
}

export function MergeSessionModal({
  open,
  sessionName,
  status,
  preview,
  error,
  onClose,
  onConfirm,
  cachedCommitMessage,
  onCommitMessageChange,
  autoCancelEnabled,
  onToggleAutoCancel,
}: MergeSessionModalProps) {
  const { registerModal, unregisterModal } = useModal()
  const [mode, setMode] = useState<MergeModeOption>('squash')
  const [commitMessage, setCommitMessage] = useState(() => cachedCommitMessage ?? '')
  const commitMessageInputRef = useRef<HTMLInputElement | null>(null)

  const focusCommitMessage = useCallback(() => {
    if (mode !== 'squash') return
    const input = commitMessageInputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    Promise.resolve().then(() => {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true })
      }
    })
  }, [mode])

  const modalId = useMemo(() => (sessionName ? `merge-${sessionName}` : 'merge'), [sessionName])

  useEffect(() => {
    if (!open) return
    registerModal(modalId)
    return () => unregisterModal(modalId)
  }, [open, modalId, registerModal, unregisterModal])

  useLayoutEffect(() => {
    if (!open) {
      setMode('squash')
      return
    }

    focusCommitMessage()
  }, [open, mode, focusCommitMessage])

  useEffect(() => {
    if (!open) {
      return
    }
    const nextMessage = cachedCommitMessage ?? ''
    setCommitMessage(prev => {
      if (prev === nextMessage) {
        return prev
      }
      return nextMessage
    })
  }, [open, cachedCommitMessage, sessionName])

  const handleModeChange = (nextMode: MergeModeOption) => {
    setMode(nextMode)
    if (nextMode === 'squash') {
      focusCommitMessage()
    }
  }

  const handleCommitMessageChange = useCallback(
    (value: string) => {
      setCommitMessage(value)
      onCommitMessageChange?.(value)
    },
    [onCommitMessageChange]
  )

  const parentBranch = preview?.parentBranch ?? '—'
  const sessionBranch = preview?.sessionBranch ?? '—'
  const hasConflicts = preview?.hasConflicts ?? false
  const conflictingPaths = preview?.conflictingPaths ?? []
  const isUpToDate = preview?.isUpToDate ?? false

  const isCommitMessageMissing = mode === 'squash' && commitMessage.trim().length === 0

  const confirmDisabled =
    status === 'loading' ||
    status === 'running' ||
    !preview ||
    hasConflicts ||
    isUpToDate ||
    isCommitMessageMissing

  const confirmTitle = hasConflicts
    ? 'Resolve merge conflicts before merging.'
    : isUpToDate
    ? 'Session has no commits to merge into the parent branch.'
    : status === 'running'
    ? 'Merging…'
    : isCommitMessageMissing
    ? 'Enter a commit message to enable merge.'
    : 'Merge session (⌘↵)'

  const handleToggleAutoCancel = useCallback(() => {
    onToggleAutoCancel(!autoCancelEnabled)
  }, [onToggleAutoCancel, autoCancelEnabled])

  const handleConfirm = useCallback(() => {
    if (status === 'loading' || status === 'running' || hasConflicts || isUpToDate) return
      if (mode === 'squash') {
        const trimmed = commitMessage.trim()
        if (!trimmed) {
          setCommitMessage('')
        focusCommitMessage()
        return
      }
      onConfirm(mode, trimmed)
    } else {
      onConfirm(mode)
    }
  }, [commitMessage, mode, onConfirm, status, hasConflicts, isUpToDate, focusCommitMessage])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        handleConfirm()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose, handleConfirm])

  if (!open || !sessionName) {
    return null
  }

  const modeDescriptions: Record<MergeModeOption, string> = {
    squash: 'Create a single commit with your message, then fast-forward the parent branch.',
    reapply: 'Replay all session commits onto the latest parent branch, preserving history.',
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[1300] px-4" style={modalBackdropStyle}>
      <div
        className="w-full max-w-2xl rounded-lg shadow-lg"
        style={modalContainerStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-session-title"
      >
          <div className="flex justify-between items-start gap-4 border-b px-6 py-4" style={{ borderColor: theme.colors.border.subtle }}>
          <div>
            <h2 id="merge-session-title" className="text-lg font-semibold" style={{ color: theme.colors.text.primary }}>
              Merge Session
            </h2>
            <p className="text-sm" style={{ color: theme.colors.text.secondary }}>
              {sessionName} → {parentBranch}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ color: theme.colors.text.secondary }}>
              <input
                type="checkbox"
                checked={autoCancelEnabled}
                onChange={handleToggleAutoCancel}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
                aria-label="Auto-cancel after merge"
              />
              <span>Auto-cancel after merge</span>
            </label>
            <button
              onClick={onClose}
              className="text-sm"
              style={{ color: theme.colors.text.secondary }}
              aria-label="Close merge dialog"
              title="Close (Esc)"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner message="Loading merge preview…" />
            </div>
          )}

          {status !== 'loading' && preview && (
            <>
              <div
                className="flex items-center gap-3 rounded px-4 py-3"
                style={{
                  backgroundColor: theme.colors.background.tertiary,
                  border: `1px solid ${theme.colors.border.subtle}`,
                }}
              >
                <span className="text-sm" style={{ color: theme.colors.text.secondary }}>
                  Auto-cancel after a successful merge is currently {autoCancelEnabled ? 'enabled' : 'disabled'}. This preference is stored per project and can also be adjusted in Settings → Project.
                </span>
              </div>

              <div>
                <span style={fieldLabelStyle}>Session branch</span>
                <div className="text-sm" style={{ color: theme.colors.text.primary }}>{sessionBranch}</div>
              </div>

              <div>
                <span style={fieldLabelStyle}>Merge strategy</span>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleModeChange('squash')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'squash' ? theme.colors.accent.green.bg : theme.colors.background.tertiary,
                      border: `1px solid ${mode === 'squash' ? theme.colors.accent.green.border : theme.colors.border.subtle}`,
                      color: theme.colors.text.primary,
                    }}
                  >
                    Squash & fast-forward
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('reapply')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'reapply' ? theme.colors.accent.blue.bg : theme.colors.background.tertiary,
                      border: `1px solid ${mode === 'reapply' ? theme.colors.accent.blue.border : theme.colors.border.subtle}`,
                      color: theme.colors.text.primary,
                    }}
                  >
                    Reapply commits
                  </button>
                </div>
                <p className="mt-2 text-sm" style={{ color: theme.colors.text.secondary }}>
                  {modeDescriptions[mode]}
                </p>
              </div>

              {mode === 'squash' && (
                <div>
                  <label style={fieldLabelStyle} htmlFor="merge-commit-message">
                    Commit message
                  </label>
                  <input
                    id="merge-commit-message"
                    ref={commitMessageInputRef}
                    autoFocus={mode === 'squash'}
                    value={commitMessage}
                    onChange={(event) => handleCommitMessageChange(event.target.value)}
                    className="mt-1 w-full rounded px-3 py-2 text-sm"
                    style={{
                      backgroundColor: theme.colors.background.tertiary,
                      border: `1px solid ${theme.colors.border.subtle}`,
                      color: theme.colors.text.primary,
                    }}
                    placeholder="Describe the changes that landed in this session"
                  />
                </div>
              )}

              {hasConflicts && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: theme.colors.accent.red.bg,
                    border: `1px solid ${theme.colors.accent.red.border}`,
                    color: theme.colors.text.primary,
                  }}
                >
                  <p className="font-medium">Resolve merge conflicts before proceeding.</p>
                  <p className="mt-1">
                    Updating {sessionBranch} with {parentBranch} would conflict.
                    {conflictingPaths.length > 0 && (
                      <span> Conflicting paths: {conflictingPaths.join(', ')}.</span>
                    )}
                  </p>
                </div>
              )}

              {!hasConflicts && isUpToDate && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: theme.colors.accent.green.bg,
                    border: `1px solid ${theme.colors.accent.green.border}`,
                    color: theme.colors.text.primary,
                  }}
                >
                  <p className="font-medium">Nothing to merge</p>
                  <p className="mt-1">{sessionBranch} has no commits to merge into {parentBranch}.</p>
                </div>
              )}

            </>
          )}

          {error && (
            <div
              className="rounded-md px-3 py-2 text-sm"
              style={{
                backgroundColor: theme.colors.accent.red.bg,
                border: `1px solid ${theme.colors.accent.red.border}`,
                color: theme.colors.text.primary,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4" style={{ borderColor: theme.colors.border.subtle }}>
          <div className="text-xs" style={{ color: theme.colors.text.secondary }}>
            Shortcut: ⌘⇧M
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border group inline-flex items-center gap-2"
              style={{
                backgroundColor: theme.colors.background.tertiary,
                borderColor: theme.colors.border.subtle,
                color: theme.colors.text.secondary,
              }}
              title="Cancel (Esc)"
            >
              <span>Cancel</span>
              <span className="text-xs opacity-60 group-hover:opacity-100">Esc</span>
            </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirmDisabled}
                className="px-4 py-2 text-sm font-medium rounded group inline-flex items-center gap-2"
                title={confirmTitle}
                style={{
                  backgroundColor: confirmDisabled
                    ? theme.colors.background.hover
                    : theme.colors.accent.green.DEFAULT,
                border: `1px solid ${theme.colors.accent.green.dark}`,
                color: confirmDisabled ? theme.colors.text.secondary : theme.colors.text.inverse,
                cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                opacity: confirmDisabled ? 0.6 : 1,
              }}
            >
              <span>{status === 'running' ? 'Merging…' : 'Merge session'}</span>
              <span className="text-xs opacity-60 group-hover:opacity-100">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
