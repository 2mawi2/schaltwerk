import { useState, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'
import { logger } from '../../utils/logger'

interface ConvertToDraftConfirmationProps {
  open: boolean
  sessionName: string
  sessionDisplayName?: string
  hasUncommittedChanges: boolean
  onClose: () => void
  onSuccess: (newSpecName?: string) => void
}

export function ConvertToSpecConfirmation({ 
  open, 
  sessionName, 
  sessionDisplayName,
  hasUncommittedChanges, 
  onClose,
  onSuccess 
}: ConvertToDraftConfirmationProps) {
  const [loading, setLoading] = useState(false)
  
  const handleConfirm = useCallback(async () => {
    if (loading) return
    
    setLoading(true)
    try {
      const result = await invoke<string | void>(TauriCommands.SchaltwerkCoreConvertSessionToDraft, {
        name: sessionName
      })
      const newSpecName = typeof result === 'string' ? result : undefined

      onSuccess(newSpecName)
      onClose()
    } catch (error) {
      logger.error('Failed to convert session to spec:', error)
      alert(`Failed to convert session to spec: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, sessionName, onSuccess, onClose])
  
  if (!open) return null

  const displayName = sessionDisplayName || sessionName

  const body = (
    <div>
      <p className="text-secondary mb-4">
        Convert <span className="font-mono" style={{ color: 'var(--color-accent-cyan)' }}>{displayName}</span> back to a spec agent?
      </p>
      {hasUncommittedChanges && (
        <div className="rounded p-3 mb-4" style={{ backgroundColor: 'var(--color-accent-amber-bg)', borderColor: 'var(--color-accent-amber-border)', borderWidth: '1px' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-accent-amber-light)' }}>⚠ Warning: Uncommitted changes will be lost</p>
          <p className="text-sm" style={{ color: 'var(--color-accent-amber)' }}>
            This session has uncommitted changes in the worktree. Converting to spec will:
          </p>
          <ul className="text-sm mt-2 ml-4 list-disc" style={{ color: 'var(--color-accent-amber)' }}>
            <li>Remove the worktree and all uncommitted changes</li>
            <li>Archive the branch</li>
            <li>Preserve the agent description as a spec</li>
          </ul>
        </div>
      )}
      {!hasUncommittedChanges && (
        <div className="bg-elevated/50 border border-subtle rounded p-3 mb-4">
          <p className="text-secondary text-sm">
            This will:
          </p>
          <ul className="text-secondary text-sm mt-2 ml-4 list-disc">
            <li>Remove the worktree</li>
            <li>Archive the branch</li>
            <li>Preserve the agent description as a spec</li>
          </ul>
        </div>
      )}
      <p className="text-tertiary text-sm">
        The agent content will be preserved and can be started again later.
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title="Convert Session to Spec"
      body={body}
      confirmText="Convert to Spec"
      confirmTitle="Convert to spec (Enter)"
      cancelText="Cancel"
      cancelTitle="Cancel (Esc)"
      onConfirm={() => { void handleConfirm() }}
      onCancel={onClose}
      confirmDisabled={loading}
      variant="warning"
    />
  )
}
