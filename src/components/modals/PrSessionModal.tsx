import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n'
import { useModal } from '../../contexts/ModalContext'
import { LoadingSpinner } from '../common/LoadingSpinner'

export interface PrPreviewResponse {
  sessionName: string
  sessionBranch: string
  parentBranch: string
  defaultTitle: string
  defaultBody: string
  commitCount: number
  commitSummaries: string[]
  defaultBranch: string
  worktreePath: string
  hasUncommittedChanges: boolean
  branchPushed: boolean
  branchConflictWarning?: string | null
}

export type PrModeOption = 'squash' | 'reapply'

export interface PrCreateOptions {
  title: string
  body: string
  baseBranch: string
  prBranchName?: string
  mode: PrModeOption
  commitMessage?: string
}

interface PrSessionModalProps {
  open: boolean
  sessionName: string | null
  status: 'idle' | 'loading' | 'ready' | 'running'
  preview: PrPreviewResponse | null
  prefill?: {
    suggestedTitle?: string
    suggestedBody?: string
    suggestedBaseBranch?: string
    suggestedPrBranchName?: string
    suggestedMode?: PrModeOption
  }
  error?: string | null
  onClose: () => void
  onConfirm: (options: PrCreateOptions) => void
  autoCancelEnabled: boolean
  onToggleAutoCancel: (next: boolean) => void
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

export function PrSessionModal({
  open,
  sessionName,
  status,
  preview,
  prefill,
  error,
  onClose,
  onConfirm,
  autoCancelEnabled,
  onToggleAutoCancel,
}: PrSessionModalProps) {
  const { registerModal, unregisterModal } = useModal()
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [prBranchName, setPrBranchName] = useState('')
  const [usePrBranchName, setUsePrBranchName] = useState(false)
  const [mode, setMode] = useState<PrModeOption>('squash')
  const [commitMessage, setCommitMessage] = useState('')
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const focusTitle = useCallback(() => {
    const input = titleInputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    void Promise.resolve().then(() => {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true })
      }
    })
  }, [])

  const modalId = useMemo(() => (sessionName ? `pr-${sessionName}` : 'pr'), [sessionName])

  useEffect(() => {
    if (!open) return
    registerModal(modalId)
    return () => unregisterModal(modalId)
  }, [open, modalId, registerModal, unregisterModal])

  useLayoutEffect(() => {
    if (!open) {
      setUsePrBranchName(false)
      setMode('squash')
      return
    }
    focusTitle()
  }, [open, focusTitle])

  useLayoutEffect(() => {
    if (!open) return
    if (status === 'ready') {
      focusTitle()
    }
  }, [open, status, focusTitle])

  useEffect(() => {
    if (!open || !preview) return

    const suggestedTitle = prefill?.suggestedTitle ?? preview.defaultTitle
    const suggestedBody = prefill?.suggestedBody ?? preview.defaultBody
    const suggestedBaseBranch = prefill?.suggestedBaseBranch ?? preview.parentBranch
    const suggestedPrBranchName = prefill?.suggestedPrBranchName ?? ''
    const suggestedMode = prefill?.suggestedMode ?? 'squash'

    setTitle(suggestedTitle)
    setBody(suggestedBody)
    setBaseBranch(suggestedBaseBranch)
    setPrBranchName(suggestedPrBranchName)
    setUsePrBranchName(!!suggestedPrBranchName)
    setMode(suggestedMode)
    setCommitMessage('')
  }, [open, preview, prefill])

  const handleToggleAutoCancel = useCallback(() => {
    onToggleAutoCancel(!autoCancelEnabled)
  }, [onToggleAutoCancel, autoCancelEnabled])

  const sessionBranch = preview?.sessionBranch ?? '—'
  const hasUncommittedChanges = preview?.hasUncommittedChanges ?? false
  const commitCount = preview?.commitCount ?? 0

  const isTitleMissing = title.trim().length === 0
  const hasBranchConflict = !!(preview?.branchConflictWarning && !usePrBranchName)
  const hasSquashConflict = !!(preview?.branchPushed && mode === 'squash' && !usePrBranchName)
  const hasUncommittedConflict = !!(preview?.branchPushed && hasUncommittedChanges && !usePrBranchName)

  const confirmDisabled =
    status === 'loading' || status === 'running' || !preview || isTitleMissing || hasBranchConflict || hasSquashConflict || hasUncommittedConflict

  const confirmTitle = status === 'running'
    ? t.prModal.tooltips.creating
    : hasBranchConflict
    ? t.prModal.tooltips.branchConflict
    : hasSquashConflict
    ? t.prModal.tooltips.squashConflict
    : hasUncommittedConflict
    ? t.prModal.tooltips.uncommittedConflict
    : isTitleMissing
    ? t.prModal.tooltips.titleMissing
    : t.prModal.tooltips.ready

  const handleConfirm = useCallback(() => {
    if (status === 'loading' || status === 'running') return
    if (hasBranchConflict || hasSquashConflict || hasUncommittedConflict) return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setTitle('')
      focusTitle()
      return
    }
    onConfirm({
      title: trimmedTitle,
      body: body.trim(),
      baseBranch: baseBranch.trim() || preview?.parentBranch || 'main',
      prBranchName: usePrBranchName ? prBranchName.trim() : undefined,
      mode,
      commitMessage: commitMessage.trim() || undefined,
    })
  }, [title, body, baseBranch, prBranchName, usePrBranchName, mode, commitMessage, onConfirm, status, preview, focusTitle, hasBranchConflict, hasSquashConflict, hasUncommittedConflict])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'Enter' && event.metaKey && !event.shiftKey) {
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

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[1300] px-4" style={modalBackdropStyle}>
      <div
        className="w-full max-w-2xl rounded-lg shadow-lg max-h-[90vh] flex flex-col"
        style={modalContainerStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pr-session-title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 border-b px-6 py-4 flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div>
            <h2 id="pr-session-title" className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t.prModal.title}
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {sessionBranch} → {baseBranch || preview?.parentBranch || '—'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={autoCancelEnabled}
                onChange={handleToggleAutoCancel}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
                aria-label={t.prModal.autoCancelAfterPr}
              />
              <span>{t.prModal.autoCancelAfterPr}</span>
            </label>
            <button
              onClick={onClose}
              className="text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
              aria-label={t.ariaLabels.closePrDialog}
              title={t.prModal.closeEsc}
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner message={t.prModal.loadingPreview} />
            </div>
          )}

          {status !== 'loading' && preview && (
            <>
              {preview.branchConflictWarning && !usePrBranchName && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-red-bg)',
                    border: '1px solid var(--color-accent-red-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.prModal.branchConflict}</p>
                  <p className="mt-1">{preview.branchConflictWarning}</p>
                </div>
              )}

              {hasSquashConflict && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-amber-bg)',
                    border: '1px solid var(--color-accent-amber-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.prModal.cannotSquashPushed}</p>
                  <p className="mt-1">{t.prModal.cannotSquashPushedDesc}</p>
                </div>
              )}

              {hasUncommittedConflict && !hasSquashConflict && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-red-bg)',
                    border: '1px solid var(--color-accent-red-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.prModal.uncommittedConflict}</p>
                  <p className="mt-1">{t.prModal.uncommittedConflictDesc}</p>
                </div>
              )}

              {hasUncommittedChanges && !hasUncommittedConflict && (
                <div
                  className="rounded-md px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-accent-amber-bg)',
                    border: '1px solid var(--color-accent-amber-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <p className="font-medium">{t.prModal.uncommittedChanges}</p>
                  <p className="mt-1">
                    {mode === 'squash'
                      ? t.prModal.uncommittedSquashHint
                      : t.prModal.uncommittedReapplyHint}
                  </p>
                </div>
              )}

              <div
                className="flex items-center gap-3 rounded px-4 py-3"
                style={{
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {mode === 'squash'
                    ? t.prModal.squashHint
                    : `${t.prModal.commitsHint.replace('{count}', String(commitCount))}${
                        hasUncommittedChanges ? t.prModal.plusUncommitted : ''
                      }.`}{' '}
                  {t.prModal.autoCancelStatus.replace('{status}', autoCancelEnabled ? t.settings.common.enabled : t.settings.common.disabled)}.
                </span>
              </div>

              <div>
                <span style={fieldLabelStyle}>{t.prModal.strategy}</span>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('squash')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'squash' ? 'var(--color-accent-green-bg)' : 'var(--color-bg-tertiary)',
                      border: `1px solid ${
                        mode === 'squash' ? 'var(--color-accent-green-border)' : 'var(--color-border-subtle)'
                      }`,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {t.prModal.squashChanges}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('reapply')}
                    className="px-3 py-2 rounded text-sm"
                    style={{
                      backgroundColor:
                        mode === 'reapply' ? 'var(--color-accent-blue-bg)' : 'var(--color-bg-tertiary)',
                      border: `1px solid ${
                        mode === 'reapply' ? 'var(--color-accent-blue-border)' : 'var(--color-border-subtle)'
                      }`,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {t.prModal.useExistingCommits}
                  </button>
                </div>
                <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {mode === 'squash'
                    ? t.prModal.squashDesc
                    : t.prModal.reapplyDesc}
                </p>
              </div>

              {(mode === 'squash' || hasUncommittedChanges) && (
                <div>
                  <label style={fieldLabelStyle} htmlFor="pr-commit-message">
                    {mode === 'squash' ? t.prModal.commitMessage : t.prModal.commitMessageUncommitted}
                  </label>
                  <input
                    id="pr-commit-message"
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    className="mt-1 w-full rounded px-3 py-2 text-sm"
                    style={{
                      backgroundColor: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border-subtle)',
                      color: 'var(--color-text-primary)',
                    }}
                    placeholder={title || 'Describe the changes'}
                  />
                </div>
              )}

              <div>
                <label style={fieldLabelStyle} htmlFor="pr-title">
                  {t.prModal.prTitle}
                </label>
                <input
                  id="pr-title"
                  ref={titleInputRef}
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full rounded px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                  placeholder={t.prModal.prTitlePlaceholder}
                />
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor="pr-body">
                  {t.prModal.description}
                </label>
                <textarea
                  id="pr-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded px-3 py-2 text-sm resize-y"
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                  placeholder={t.prModal.descriptionPlaceholder}
                />
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor="pr-base-branch">
                  {t.prModal.baseBranch}
                </label>
                <input
                  id="pr-base-branch"
                  value={baseBranch}
                  onChange={(event) => setBaseBranch(event.target.value)}
                  className="mt-1 w-full rounded px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                  placeholder={preview.parentBranch}
                />
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t.prModal.baseBranchHint}
                </p>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={usePrBranchName}
                    onChange={(e) => setUsePrBranchName(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
                  />
                  <span>{t.prModal.useCustomBranch}</span>
                </label>
                {usePrBranchName && (
                  <>
                    <input
                      id="pr-branch-name"
                      value={prBranchName}
                      onChange={(event) => setPrBranchName(event.target.value)}
                      className="mt-1 w-full rounded px-3 py-2 text-sm"
                      style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border-subtle)',
                        color: 'var(--color-text-primary)',
                      }}
                      placeholder={`pr/${sessionName}`}
                    />
                    <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {t.prModal.customBranchHint}
                    </p>
                  </>
                )}
              </div>

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

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4 flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {t.prModal.shortcutHint}
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
              title={`${t.prModal.cancel} (Esc)`}
            >
              <span>{t.prModal.cancel}</span>
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
                  : 'var(--color-accent-blue)',
                border: '1px solid var(--color-accent-blue-dark)',
                color: confirmDisabled ? 'var(--color-text-secondary)' : 'var(--color-text-inverse)',
                cursor: confirmDisabled ? 'not-allowed' : 'pointer',
                opacity: confirmDisabled ? 0.6 : 1,
              }}
            >
              <span>{status === 'running' ? t.prModal.creatingPr : t.prModal.createPr}</span>
              <span className="text-xs opacity-60 group-hover:opacity-100">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
