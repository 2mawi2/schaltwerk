import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n'
import { useModal } from '../../contexts/ModalContext'
import { TauriCommands } from '../../common/tauriCommands'
import { useToast } from '../../common/toast/ToastProvider'
import { useGitlabIntegrationContext } from '../../contexts/GitlabIntegrationContext'
import { logger } from '../../utils/logger'
import type { GitlabSource } from '../../types/gitlabTypes'

export type MrModeOption = 'squash' | 'reapply'

export interface MrCreateResult {
  url: string
  branch: string
}

interface GitlabMrSessionModalProps {
  open: boolean
  sessionName: string | null
  prefill?: {
    suggestedTitle?: string
    suggestedBody?: string
    suggestedBaseBranch?: string
    suggestedSourceProject?: string
  }
  onClose: () => void
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
  fontSize: theme.fontSize.label,
}

export function GitlabMrSessionModal({
  open,
  sessionName,
  prefill,
  onClose,
}: GitlabMrSessionModalProps) {
  const { registerModal, unregisterModal } = useModal()
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const { sources } = useGitlabIntegrationContext()

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')
  const [mrBranchName, setMrBranchName] = useState('')
  const [useMrBranchName, setUseMrBranchName] = useState(false)
  const [mode, setMode] = useState<MrModeOption>('squash')
  const [commitMessage, setCommitMessage] = useState('')
  const [selectedSource, setSelectedSource] = useState<GitlabSource | null>(null)
  const [squashOnMerge, setSquashOnMerge] = useState(false)
  const [cancelAfterMr, setCancelAfterMr] = useState(false)
  const [status, setStatus] = useState<'idle' | 'creating'>('idle')
  const [error, setError] = useState<string | null>(null)
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

  const modalId = useMemo(() => (sessionName ? `gitlab-mr-${sessionName}` : 'gitlab-mr'), [sessionName])

  useEffect(() => {
    if (!open) return
    registerModal(modalId)
    return () => unregisterModal(modalId)
  }, [open, modalId, registerModal, unregisterModal])

  useLayoutEffect(() => {
    if (!open) {
      setUseMrBranchName(false)
      setMode('squash')
      setStatus('idle')
      setError(null)
      return
    }
    focusTitle()
  }, [open, focusTitle])

  useEffect(() => {
    if (!open) return

    setTitle(prefill?.suggestedTitle ?? '')
    setBody(prefill?.suggestedBody ?? '')
    setBaseBranch(prefill?.suggestedBaseBranch ?? 'main')
    setCommitMessage('')
    setSquashOnMerge(false)
    setCancelAfterMr(false)

    if (prefill?.suggestedSourceProject && sources.length > 0) {
      const match = sources.find(s => s.projectPath === prefill.suggestedSourceProject)
      if (match) {
        setSelectedSource(match)
      } else {
        setSelectedSource(sources[0] ?? null)
      }
    } else {
      setSelectedSource(sources[0] ?? null)
    }

    void Promise.resolve().then(focusTitle)
  }, [open, prefill, sources, focusTitle])

  const isTitleMissing = title.trim().length === 0
  const isSourceMissing = !selectedSource
  const confirmDisabled = status === 'creating' || isTitleMissing || isSourceMissing

  const handleConfirm = useCallback(async () => {
    if (status === 'creating') return
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setTitle('')
      focusTitle()
      return
    }
    if (!selectedSource || !sessionName) return

    setStatus('creating')
    setError(null)

    try {
      const result = await invoke<MrCreateResult>(TauriCommands.GitLabCreateSessionMr, {
        args: {
          sessionName,
          mrTitle: trimmedTitle,
          mrBody: body.trim(),
          baseBranch: baseBranch.trim() || 'main',
          mrBranchName: useMrBranchName ? mrBranchName.trim() : undefined,
          commitMessage: commitMessage.trim() || undefined,
          sourceProject: selectedSource.projectPath,
          sourceHostname: selectedSource.hostname,
          squash: squashOnMerge,
          mode,
          cancelAfterMr,
        }
      })

      onClose()

      if (result.url) {
        const mrUrl = result.url
        pushToast({
          tone: 'success',
          title: t.gitlabMrModal.created,
          description: t.gitlabMrModal.createdDesc,
          action: {
            label: t.gitlabMrModal.openInGitlab,
            onClick: () => {
              void invoke(TauriCommands.OpenExternalUrl, { url: mrUrl }).catch((err: unknown) => {
                logger.warn('Failed to open GitLab MR URL via Tauri, falling back to window.open', err)
                window.open(mrUrl, '_blank', 'noopener,noreferrer')
              })
            },
          },
        })
      }
    } catch (err) {
      logger.error('Failed to create GitLab MR', err)
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('idle')
    }
  }, [
    title, body, baseBranch, mrBranchName, useMrBranchName, mode, commitMessage,
    selectedSource, sessionName, squashOnMerge, cancelAfterMr, status,
    onClose, pushToast, focusTitle, t,
  ])

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
        void handleConfirm()
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
        aria-labelledby="gitlab-mr-session-title"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 border-b px-6 py-4 flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div>
            <h2 id="gitlab-mr-session-title" className="text-heading font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t.gitlabMrModal.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-body"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-label={t.ariaLabels.close}
          >
            x
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <span style={fieldLabelStyle}>{t.gitlabMrModal.selectSource}</span>
            {sources.length === 0 ? (
              <p className="mt-1 text-body" style={{ color: 'var(--color-text-tertiary)' }}>
                {t.gitlabMrModal.noSourcesConfigured}
              </p>
            ) : (
              <select
                value={selectedSource?.id ?? ''}
                onChange={(e) => {
                  const source = sources.find(s => s.id === e.target.value)
                  setSelectedSource(source ?? null)
                }}
                className="mt-1 w-full rounded px-3 py-2 text-body"
                style={{
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label} ({source.projectPath})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <span style={fieldLabelStyle}>{t.gitlabMrModal.strategy}</span>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('squash')}
                className="px-3 py-2 rounded text-body"
                style={{
                  backgroundColor:
                    mode === 'squash' ? 'var(--color-accent-green-bg)' : 'var(--color-bg-tertiary)',
                  border: `1px solid ${
                    mode === 'squash' ? 'var(--color-accent-green-border)' : 'var(--color-border-subtle)'
                  }`,
                  color: 'var(--color-text-primary)',
                }}
              >
                {t.gitlabMrModal.squashChanges}
              </button>
              <button
                type="button"
                onClick={() => setMode('reapply')}
                className="px-3 py-2 rounded text-body"
                style={{
                  backgroundColor:
                    mode === 'reapply' ? 'var(--color-accent-blue-bg)' : 'var(--color-bg-tertiary)',
                  border: `1px solid ${
                    mode === 'reapply' ? 'var(--color-accent-blue-border)' : 'var(--color-border-subtle)'
                  }`,
                  color: 'var(--color-text-primary)',
                }}
              >
                {t.gitlabMrModal.useExistingCommits}
              </button>
            </div>
            <p className="mt-2 text-body" style={{ color: 'var(--color-text-secondary)' }}>
              {mode === 'squash'
                ? t.gitlabMrModal.squashDesc
                : t.gitlabMrModal.reapplyDesc}
            </p>
          </div>

          {mode === 'squash' && (
            <div>
              <label style={fieldLabelStyle} htmlFor="gitlab-mr-commit-message">
                {t.gitlabMrModal.commitMessage}
              </label>
              <input
                id="gitlab-mr-commit-message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                className="mt-1 w-full rounded px-3 py-2 text-body"
                style={{
                  backgroundColor: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
                placeholder={title || t.placeholders.describeChanges}
              />
            </div>
          )}

          <div>
            <label style={fieldLabelStyle} htmlFor="gitlab-mr-title">
              {t.gitlabMrModal.mrTitle}
            </label>
            <input
              id="gitlab-mr-title"
              ref={titleInputRef}
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded px-3 py-2 text-body"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
              placeholder={t.gitlabMrModal.mrTitlePlaceholder}
            />
          </div>

          <div>
            <label style={fieldLabelStyle} htmlFor="gitlab-mr-body">
              {t.gitlabMrModal.description}
            </label>
            <textarea
              id="gitlab-mr-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              className="mt-1 w-full rounded px-3 py-2 text-body resize-y"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
              placeholder={t.gitlabMrModal.descriptionPlaceholder}
            />
          </div>

          <div>
            <label style={fieldLabelStyle} htmlFor="gitlab-mr-target-branch">
              {t.gitlabMrModal.targetBranch}
            </label>
            <input
              id="gitlab-mr-target-branch"
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              className="mt-1 w-full rounded px-3 py-2 text-body"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
              placeholder="main"
            />
            <p className="mt-1 text-caption" style={{ color: 'var(--color-text-tertiary)' }}>
              {t.gitlabMrModal.targetBranchHint}
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 text-body mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={useMrBranchName}
                onChange={(e) => setUseMrBranchName(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
              />
              <span>{t.gitlabMrModal.useCustomBranch}</span>
            </label>
            {useMrBranchName && (
              <>
                <input
                  id="gitlab-mr-branch-name"
                  value={mrBranchName}
                  onChange={(event) => setMrBranchName(event.target.value)}
                  className="mt-1 w-full rounded px-3 py-2 text-body"
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                  placeholder={`mr/${sessionName}`}
                />
                <p className="mt-1 text-caption" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t.gitlabMrModal.customBranchHint}
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-body" style={{ color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={squashOnMerge}
                onChange={(e) => setSquashOnMerge(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
              />
              <span>{t.gitlabMrModal.squashOnMerge}</span>
            </label>
            <label className="flex items-center gap-2 text-body" style={{ color: 'var(--color-text-secondary)' }}>
              <input
                type="checkbox"
                checked={cancelAfterMr}
                onChange={(e) => setCancelAfterMr(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
              />
              <span>{t.gitlabMrModal.autoCancelAfterMr}</span>
            </label>
          </div>

          {error && (
            <div
              className="rounded-md px-3 py-2 text-body"
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
          <div className="text-caption" style={{ color: 'var(--color-text-secondary)' }}>
            {t.gitlabMrModal.shortcutHint}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-body rounded border group inline-flex items-center gap-2"
              style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span>{t.gitlabMrModal.cancel}</span>
              <span className="text-caption opacity-60 group-hover:opacity-100">Esc</span>
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirm() }}
              disabled={confirmDisabled}
              className="px-4 py-2 text-body font-medium rounded group inline-flex items-center gap-2"
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
              <span>{status === 'creating' ? t.gitlabMrModal.creatingMr : t.gitlabMrModal.createMr}</span>
              <span className="text-caption opacity-60 group-hover:opacity-100">{'\u2318\u21B5'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
