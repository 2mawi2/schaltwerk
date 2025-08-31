import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'
import { AnimatedText } from '../common/AnimatedText'
import { theme } from '../../common/theme'

interface ConvertToDraftConfirmationProps {
  open: boolean
  sessionName: string
  sessionDisplayName?: string
  hasUncommittedChanges: boolean
  onClose: () => void
  onSuccess: () => void
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
      await invoke('schaltwerk_core_convert_session_to_draft', {
        name: sessionName
      })
      
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to convert session to spec:', error)
      alert(`Failed to convert session to spec: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, sessionName, onSuccess, onClose])
  
  if (!open) return null

  const displayName = sessionDisplayName || sessionName

  const body = (
    <div>
      <p className="text-slate-300 mb-4">
        Convert <span className="font-mono text-blue-400">{displayName}</span> back to a spec agent?
      </p>
      {hasUncommittedChanges && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm font-semibold mb-2">⚠ Warning: Uncommitted changes will be lost</p>
          <p className="text-amber-100 text-sm">
            This session has uncommitted changes in the worktree. Converting to spec will:
          </p>
          <ul className="text-amber-100 text-sm mt-2 ml-4 list-disc">
            <li>Remove the worktree and all uncommitted changes</li>
            <li>Archive the branch</li>
            <li>Preserve the agent description as a spec</li>
          </ul>
        </div>
      )}
      {!hasUncommittedChanges && (
        <div className="bg-slate-800/50 border border-slate-700 rounded p-3 mb-4">
          <p className="text-slate-300 text-sm">
            This will:
          </p>
          <ul className="text-slate-300 text-sm mt-2 ml-4 list-disc">
            <li>Remove the worktree</li>
            <li>Archive the branch</li>
            <li>Preserve the agent description as a spec</li>
          </ul>
        </div>
      )}
      <p className="text-slate-400 text-sm">
        The agent content will be preserved and can be started again later.
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title="Convert Session to Spec"
      body={body}
      confirmText={loading ? (
        <AnimatedText text="converting" colorClassName={theme.colors.text.muted} size="xs" centered={false} />
      ) : (
        'Convert to Spec'
      )}
      confirmTitle="Convert to spec (Enter)"
      cancelText="Cancel"
      cancelTitle="Cancel (Esc)"
      onConfirm={handleConfirm}
      onCancel={onClose}
      confirmDisabled={loading}
      loading={loading}
      variant="warning"
    />
  )
}