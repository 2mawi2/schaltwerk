import { useState, useCallback, useEffect, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'
import { logger } from '../../utils/logger'

interface MarkReadyConfirmationProps {
  open: boolean
  sessionName: string
  hasUncommittedChanges: boolean
  onClose: () => void
  onSuccess: () => void
}

export function MarkReadyConfirmation({
  open,
  sessionName,
  hasUncommittedChanges,
  onClose,
  onSuccess
}: MarkReadyConfirmationProps) {
  const [autoCommit, setAutoCommit] = useState(true)
  const [customMessage, setCustomMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [freshHasUncommitted, setFreshHasUncommitted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) {
      setFreshHasUncommitted(null)
      setCustomMessage('')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const dirty = await invoke<boolean>(TauriCommands.SchaltwerkCoreHasUncommittedChanges, { name: sessionName })

        if (!cancelled) {
          setFreshHasUncommitted(dirty)
        }
      } catch (error) {
        logger.error('Failed to check uncommitted changes:', error)
        if (!cancelled) {
          setFreshHasUncommitted(hasUncommittedChanges)
        }
      }
    })()

    return () => { cancelled = true }
  }, [open, sessionName, hasUncommittedChanges])

  const effectiveHasUncommitted = useMemo(() => {
    return freshHasUncommitted ?? hasUncommittedChanges
  }, [freshHasUncommitted, hasUncommittedChanges])
  
  const handleConfirm = useCallback(async () => {
    if (loading) return
    if (effectiveHasUncommitted && !autoCommit) return

    setLoading(true)
    try {
      const commitMessage = customMessage.trim() || undefined

      const success = await invoke<boolean>(TauriCommands.SchaltwerkCoreMarkSessionReady, {
        name: sessionName,
        autoCommit: autoCommit,
        commitMessage
      })

      if (success) {
        onSuccess()
        onClose()
      } else {
        alert('Session has uncommitted changes. Please commit them first or enable auto-commit.')
      }
    } catch (error) {
      logger.error('Failed to mark session as reviewed:', error)
      alert(`Failed to mark session as reviewed: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, effectiveHasUncommitted, autoCommit, customMessage, sessionName, onSuccess, onClose])
  
  if (!open) return null

  const body = (
    <div>
      <p className="text-slate-300 mb-4">
        Marking <span className="font-mono text-cyan-400">{sessionName}</span> as reviewed.
      </p>
      {effectiveHasUncommitted && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm mb-3">⚠ This session has uncommitted changes</p>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={autoCommit}
              onChange={(e) => setAutoCommit(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-cyan-400 focus:ring-cyan-400"
            />
            <span className="text-sm text-slate-300">
              Automatically commit all changes
            </span>
          </label>
          {autoCommit && (
            <div className="ml-6 mb-3">
              <label className="block text-xs text-slate-400 mb-1">
                Custom commit message (optional):
              </label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleConfirm()
                  }
                }}
                placeholder={`Complete development work for ${sessionName}`}
                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 text-sm focus:outline-none focus:border-cyan-400 transition-colors"
                spellCheck={false}
              />
              <p className="text-xs text-slate-500 mt-1">
                Leave empty to use the default message • Press Enter to submit
              </p>
            </div>
          )}
          <p className="text-slate-500 text-xs">
            💡 Tip: You can enable auto-commit globally in Settings → Sessions to skip this dialog entirely.
          </p>
        </div>
      )}
      <p className="text-slate-400 text-sm">
        Reviewed sessions will be moved to the bottom of the list and visually marked as complete. They can be merged later.
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title={"Mark Session as Reviewed"}
      body={body}
      confirmText={loading ? 'Loading…' : 'Mark as Reviewed'}
      confirmTitle="Mark as reviewed (Enter)"
      cancelText="Cancel"
      cancelTitle="Cancel (Esc)"
      onConfirm={handleConfirm}
      onCancel={onClose}
      confirmDisabled={loading || (effectiveHasUncommitted && !autoCommit)}
      loading={loading}
      variant="success"
    />
  )
}
