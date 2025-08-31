import { useState, useCallback, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'
import { AnimatedText } from '../common/AnimatedText'
import { theme } from '../../common/theme'

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
  const [loading, setLoading] = useState(false)
  const [freshHasUncommitted, setFreshHasUncommitted] = useState<boolean | null>(null)

  // Load fresh uncommitted changes state when modal opens
  useEffect(() => {
    if (!open) {
      setFreshHasUncommitted(null)
      return
    }
    
    let cancelled = false
    ;(async () => {
      try {
        const dirty = await invoke<boolean>('schaltwerk_core_has_uncommitted_changes', { name: sessionName })
        
        if (!cancelled) {
          setFreshHasUncommitted(dirty)
        }
      } catch (error) {
        console.error('Failed to check uncommitted changes:', error)
        // If check fails, fall back to the passed value
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
      const success = await invoke<boolean>('schaltwerk_core_mark_session_ready', {
        name: sessionName,
        // Always pass current autoCommit choice; backend is idempotent if clean
        autoCommit: autoCommit
      })
      
      if (success) {
        onSuccess()
        onClose()
      } else {
        alert('Session has uncommitted changes. Please commit them first or enable auto-commit.')
      }
    } catch (error) {
      console.error('Failed to mark session as reviewed:', error)
      alert(`Failed to mark session as reviewed: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, effectiveHasUncommitted, autoCommit, sessionName, onSuccess, onClose])
  
  if (!open) return null

  const body = (
    <div>
      <p className="text-slate-300 mb-4">
        Marking <span className="font-mono text-blue-400">{sessionName}</span> as reviewed.
      </p>
      {effectiveHasUncommitted && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm mb-3">⚠ This session has uncommitted changes</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCommit}
              onChange={(e) => setAutoCommit(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-300">
              Automatically commit all changes with message "Mark session {sessionName} as reviewed"
            </span>
          </label>
          <p className="text-slate-500 text-xs mt-2">
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
       confirmText={loading ? (
        <AnimatedText text="marking" colorClassName={theme.colors.text.muted} size="xs" centered={false} />
      ) : (
        'Mark as Reviewed'
      )}
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