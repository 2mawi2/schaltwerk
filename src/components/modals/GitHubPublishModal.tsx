import { useCallback, useEffect, useMemo, useState } from 'react'
import { SessionInfo } from '../../types/session'
import { useModal } from '../../contexts/ModalContext'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  GitHubPublishContextResponse,
  GitHubPublishResponse,
  GitHubRemote,
  GitHubPublishMode,
} from '../../types/github'
import clsx from 'clsx'
import { logger } from '../../utils/logger'

interface GitHubPublishModalProps {
  open: boolean
  session: SessionInfo
  onClose: () => void
  onCancelSession: (sessionId: string) => void
}

export function GitHubPublishModal({
  open,
  session,
  onClose,
  onCancelSession
}: GitHubPublishModalProps) {
  const { registerModal, unregisterModal } = useModal()
  const [context, setContext] = useState<GitHubPublishContextResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRemote, setSelectedRemote] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [targetBranch, setTargetBranch] = useState('')
  const [mode, setMode] = useState<GitHubPublishMode>('squash')
  const [commitMessage, setCommitMessage] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [publishResult, setPublishResult] = useState<GitHubPublishResponse | null>(null)

  useEffect(() => {
    if (open) {
      registerModal('GitHubPublishModal')
    } else {
      unregisterModal('GitHubPublishModal')
    }
    return () => unregisterModal('GitHubPublishModal')
  }, [open, registerModal, unregisterModal])

  useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    setPublishResult(null)
    setAcknowledged(false)

    invoke<GitHubPublishContextResponse>(TauriCommands.GitHubPublishGetContext, {
      sessionName: session.session_id,
    })
      .then((ctx) => {
        if (!active) return
        setContext(ctx)
        const defaultRemote = ctx.linked?.remote_name ?? ctx.remotes[0]?.remote_name ?? ''
        setSelectedRemote(defaultRemote)
        setBaseBranch(ctx.default_base_branch)
        setTargetBranch(ctx.suggested_target_branch)

        const normalizedMode: GitHubPublishMode =
          ctx.last_publish_mode === 'keep' || ctx.last_publish_mode === 'keep_commits'
            ? 'keep'
            : 'squash'
        setMode(normalizedMode)
        setCommitMessage(ctx.commit_message_suggestion ?? '')
      })
      .catch((err) => {
        if (!active) return
        logger.error('Failed to load GitHub publish context', err)
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, session.session_id])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return

    let unlistenCompleted: UnlistenFn | undefined
    let unlistenFailed: UnlistenFn | undefined

    ;(async () => {
      try {
        unlistenCompleted = await listenEvent(
          SchaltEvent.GitHubPublishCompleted,
          (payload) => {
            if (!open || payload.session_name !== session.session_id) return
            setPublishResult({
              compare_url: payload.compare_url,
              pushed_branch: payload.branch,
              mode: payload.mode,
            })
            setError(null)
            setSubmitting(false)
          }
        )

        unlistenFailed = await listenEvent(
          SchaltEvent.GitHubPublishFailed,
          (payload) => {
            if (!open || payload.session_name !== session.session_id) return
            setPublishResult(null)
            setSubmitting(false)
            setError(payload.error)
          }
        )
      } catch (err) {
        logger.warn('Failed to register GitHub publish event listeners', err)
      }
    })()

    return () => {
      if (unlistenCompleted) void unlistenCompleted()
      if (unlistenFailed) void unlistenFailed()
    }
  }, [open, session.session_id])

  const availableBranches = useMemo(() => {
    if (!context) return []
    const set = new Set(context.available_branches)
    set.add(context.session_base_branch)
    set.add(context.default_base_branch)
    return Array.from(set)
  }, [context])

  const selectedRemoteDetails: GitHubRemote | undefined = useMemo(() => {
    if (!context) return undefined
    return context.remotes.find((remote) => remote.remote_name === selectedRemote)
  }, [context, selectedRemote])

  const hasRemotes = !!context && context.remotes.length > 0

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!context || submitting || !hasRemotes || !selectedRemoteDetails) return

      setSubmitting(true)
      setError(null)

      try {
        const response = await invoke<GitHubPublishResponse>(
          TauriCommands.GitHubPublishPrepare,
          {
            sessionName: session.session_id,
            remoteName: selectedRemote,
            targetBranch: targetBranch.trim(),
            baseBranch,
            mode,
            commitMessage: commitMessage.trim(),
          }
        )
        setPublishResult(response)
      } catch (err) {
        logger.error('GitHub publish failed', err)
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
      } finally {
        setSubmitting(false)
      }
    },
    [
      context,
      submitting,
      session.session_id,
      selectedRemote,
      targetBranch,
      baseBranch,
      mode,
      commitMessage,
      hasRemotes,
      selectedRemoteDetails,
    ]
  )

  if (!open) return null

  const confirmDisabled =
    !context ||
    !hasRemotes ||
    !selectedRemoteDetails ||
    selectedRemote === '' ||
    targetBranch.trim() === '' ||
    baseBranch.trim() === '' ||
    !acknowledged ||
    submitting ||
    context.has_uncommitted_changes

  const renderModeToggle = () => (
    <div className="flex gap-2 mt-4" role="group" aria-label="Publish mode">
      <button
        type="button"
        className={clsx(
          'px-3 py-1 text-sm rounded border transition-colors',
          mode === 'squash'
            ? 'bg-green-700 border-green-500 text-white'
            : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
        )}
        aria-pressed={mode === 'squash'}
        onClick={() => setMode('squash')}
      >
        Squash into single commit
      </button>
      <button
        type="button"
        className={clsx(
          'px-3 py-1 text-sm rounded border transition-colors',
          mode === 'keep'
            ? 'bg-blue-700 border-blue-500 text-white'
            : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
        )}
        aria-pressed={mode === 'keep'}
        onClick={() => setMode('keep')}
      >
        Keep existing commits
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-full max-w-2xl mx-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Create Pull Request</h2>
            <p className="text-sm text-slate-400 mt-1">
              Schaltwerk will push a branch to the selected remote and open the GitHub compare page to finish creating the PR.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loading && (
          <div className="text-slate-300 text-sm">Loading GitHub information…</div>
        )}

        {!loading && error && (
          <div className="text-sm text-red-400 mb-3" role="alert">
            {error}
          </div>
        )}

        {!loading && context && !publishResult && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300" htmlFor="github-remote">
                Remote
              </label>
              <select
                id="github-remote"
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedRemote}
                onChange={(e) => setSelectedRemote(e.target.value)}
                disabled={!hasRemotes}
              >
                {context.remotes.map((remote) => (
                  <option key={remote.remote_name} value={remote.remote_name}>
                    {remote.remote_name} ({remote.owner}/{remote.repo})
                  </option>
                ))}
              </select>
              {!hasRemotes && (
                <p className="text-xs text-amber-400 mt-1">
                  No GitHub remotes detected for this project. Add a GitHub remote (e.g. origin) and try again.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="github-base-branch">
                  Base branch
                </label>
                <select
                  id="github-base-branch"
                  className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                >
                  {availableBranches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300" htmlFor="github-target-branch">
                  Target branch
                </label>
                <input
                  id="github-target-branch"
                  type="text"
                  className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                  placeholder={context.suggested_target_branch}
                  aria-label="Target branch"
                />
              </div>
            </div>

            {renderModeToggle()}

            <div>
              <label className="block text-sm font-medium text-slate-300" htmlFor="github-commit-title">
                Commit title
              </label>
              <input
                id="github-commit-title"
                type="text"
                className="mt-1 w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={context.commit_message_suggestion}
                aria-label="Commit title"
              />
              {mode === 'keep' && (
                <p className="text-xs text-slate-500 mt-1">
                  Existing commits will be pushed as-is. GitHub will ask for the PR title when you open the browser.
                </p>
              )}
            </div>

            {selectedRemoteDetails && (
              <div className="text-sm text-slate-400">
                Selected remote points to <span className="text-slate-200">{selectedRemoteDetails.owner}/{selectedRemoteDetails.repo}</span> on {selectedRemoteDetails.host}.
              </div>
            )}

            {context.has_uncommitted_changes && (
              <div className="text-sm text-amber-400">
                This session has uncommitted changes. Commit or discard them before publishing.
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                aria-label="I understand Schaltwerk will push this branch to the remote"
              />
              <span>I understand Schaltwerk will push this branch to the remote</span>
            </label>

            {error && (
              <div className="text-sm text-red-400" role="alert">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-600 rounded-md hover:bg-slate-700"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={confirmDisabled}
              >
                {submitting ? 'Publishing…' : 'Create Branch & Open PR'}
              </button>
            </div>
          </form>
        )}

        {publishResult && (
          <div className="space-y-4">
            <div className="text-sm text-green-400" role="status">
              Branch pushed successfully. Finish creating the PR in your browser.
            </div>
            <div className="text-sm text-slate-300">
              Remote branch <span className="text-slate-100">{publishResult.pushed_branch}</span> is ready against base <span className="text-slate-100">{baseBranch}</span>.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-500"
                onClick={() => {
                  onCancelSession(session.session_id)
                  onClose()
                }}
              >
                PR created – cancel session
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-600 rounded-md hover:bg-slate-700"
                onClick={onClose}
              >
                Keep session
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
