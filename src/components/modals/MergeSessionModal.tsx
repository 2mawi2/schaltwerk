import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../../common/theme'
import { useModal } from '../../contexts/ModalContext'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { useTranslation } from '../../common/i18n'

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
  prefillMode?: MergeModeOption
}

const modalBackdropStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-overlay-backdrop)',
}

const modalContainerStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text-primary)',
}

const fieldLabelStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
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
  prefillMode,
}: MergeSessionModalProps) {
  const { t } = useTranslation()
  const { registerModal, unregisterModal } = useModal()
  const [mode, setMode] = useState<MergeModeOption>('squash')
  const [commitMessage, setCommitMessage] = useState(() => cachedCommitMessage ?? '')
  const commitMessageInputRef = useRef<HTMLInputElement | null>(null)

  const focusCommitMessage = useCallback(() => {
    if (mode !== 'squash') return
    const input = commitMessageInputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    void Promise.resolve().then(() => {
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

  useLayoutEffect(() => {
    if (!open || !prefillMode) return
    setMode(prefillMode)
  }, [open, prefillMode])

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    if (status === 'ready') {
      focusCommitMessage()
    }
  }, [open, status, focusCommitMessage])

  useEffect(() => {
    if (!open) {
      return
    }

    const nextValue = typeof cachedCommitMessage === 'string' ? cachedCommitMessage : ''
    setCommitMessage(prev => (prev === nextValue ? prev : nextValue))
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
    ? t.mergeSessionModal.tooltips.hasConflicts
    : isUpToDate
    ? t.mergeSessionModal.tooltips.isUpToDate
    : status === 'running'
    ? t.mergeSessionModal.tooltips.isMerging
    : isCommitMessageMissing
    ? t.mergeSessionModal.tooltips.needsCommitMessage
    : t.mergeSessionModal.tooltips.readyToMerge

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
    squash: t.mergeSessionModal.squashDesc,
    reapply: t.mergeSessionModal.reapplyDesc,
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[1300] px-4" style={modalBackdropStyle}>
      <div
        className="w-full max-w-2xl rounded-lg shadow-lg"
        style={modalContainerStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-session-title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 border-b px-6 py-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div>
            <h2 id="merge-session-title" className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t.mergeSessionModal.title}
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {sessionName} → {parentBranch}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={autoCancelEnabled}
                onChange={handleToggleAutoCancel}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
                aria-label={t.mergeSessionModal.autoCancelAfterMerge}
              />
              <span>{t.mergeSessionModal.autoCancelAfterMerge}</span>
            </label>
            <button
              onClick={onClose}
              className="text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
              aria-label={t.ariaLabels.closeMergeDialog}
              title={t.mergeSessionModal.closeEsc}
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
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {t.mergeSessionModal.autoCancelStatus.replace('{status}', autoCancelEnabled ? t.settings.common.enabled.toLowerCase() : t.settings.common.disabled.toLowerCase())}
                </span>
              </div>

              <div>
                <span style={fieldLabelStyle}>{t.mergeSessionModal.sessionBranch}</span>
                <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{sessionBranch}</div>
              </div>

              <div>
                <span style={fieldLabelStyle}>{t.mergeSessionModal.mergeStrategy}</span>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleModeChange('squash')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'squash' ? 'var(--color-accent-green-bg)' : 'var(--color-bg-tertiary)',
                      border: `1px solid ${mode === 'squash' ? 'var(--color-accent-green-border)' : 'var(--color-border-subtle)'}`,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {t.mergeSessionModal.squashFastForward}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('reapply')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'reapply' ? 'var(--color-accent-blue-bg)' : 'var(--color-bg-tertiary)',
                      border: `1px solid ${mode === 'reapply' ? 'var(--color-accent-blue-border)' : 'var(--color-border-subtle)'}`,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {t.mergeSessionModal.reapplyCommits}
                  </button>
                </div>
                <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {modeDescriptions[mode]}
                </p>
              </div>

              {mode === 'squash' && (
                <div>
                  <label style={fieldLabelStyle} htmlFor="merge-commit-message">
                    {t.mergeSessionModal.commitMessage}
                  </label>
                  <input
                    id="merge-commit-message"
                    ref={commitMessageInputRef}
                    autoFocus={mode === 'squash'}
                    value={commitMessage}
                    onChange={(event) => handleCommitMessageChange(event.target.value)}
                    className="mt-1 w-full rounded px-3 py-2 text-sm"
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border-subtle)',
                      color: 'var(--color-text-primary)',
                    }}
                    placeholder={preview?.defaultCommitMessage || t.mergeSessionModal.commitPlaceholder}
                  />
                </div>
              )}

              {hasConflicts && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-red-bg)',
                    border: '1px solid var(--color-accent-red-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.mergeSessionModal.resolveConflicts}</p>
                  <p className="mt-1">
                    {t.mergeSessionModal.conflictsBody.replace('{sessionBranch}', sessionBranch).replace('{parentBranch}', parentBranch)}
                    {conflictingPaths.length > 0 && (
                      <span> {t.mergeSessionModal.conflictingPaths.replace('{paths}', conflictingPaths.join(', '))}</span>
                    )}
                  </p>
                </div>
              )}

              {!hasConflicts && isUpToDate && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-green-bg)',
                    border: '1px solid var(--color-accent-green-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.mergeSessionModal.nothingToMerge}</p>
                  <p className="mt-1">{t.mergeSessionModal.nothingToMergeBody.replace('{sessionBranch}', sessionBranch).replace('{parentBranch}', parentBranch)}</p>
                </div>
              )}

            </>
          )}

          {error && (
            <div
              className="rounded-md px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--color-accent-red-bg)',
                border: '1px solid var(--color-accent-red-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t.mergeSessionModal.shortcutHint}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border group inline-flex items-center gap-2"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
              title={t.newSessionModal.cancelEsc}
            >
              <span>{t.mergeSessionModal.cancel}</span>
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
                    ? 'var(--color-bg-hover)'
                    : 'var(--color-accent-green)',
                  border: '1px solid var(--color-accent-green-dark)',
                  color: confirmDisabled ? 'var(--color-text-secondary)' : 'var(--color-text-inverse)',
                  cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                  opacity: confirmDisabled ? 0.6 : 1,
                }}
            >
              <span>{status === 'running' ? t.mergeSessionModal.merging : t.mergeSessionModal.mergeSession}</span>
              <span className="text-xs opacity-60 group-hover:opacity-100">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
