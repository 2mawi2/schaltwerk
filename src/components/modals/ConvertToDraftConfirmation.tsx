import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'

interface ConvertToDraftConfirmationProps {
  open: boolean
  sessionName: string
  sessionDisplayName?: string
  hasUncommittedChanges: boolean
  onClose: () => void
  onSuccess: () => void
}

export function ConvertToDraftConfirmation({ 
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
      await invoke('para_core_convert_session_to_draft', {
        name: sessionName
      })
      
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to convert session to draft:', error)
      alert(`Failed to convert session to draft: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [loading, sessionName, onSuccess, onClose])
  
  if (!open) return null

  const displayName = sessionDisplayName || sessionName

  const body = (
    <div>
      <p className="text-slate-300 mb-4">
        Convert <span className="font-mono text-blue-400">{displayName}</span> back to a draft task?
      </p>
      {hasUncommittedChanges && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm font-semibold mb-2">⚠ Warning: Uncommitted changes will be lost</p>
          <p className="text-amber-100 text-sm">
            This session has uncommitted changes in the worktree. Converting to draft will:
          </p>
          <ul className="text-amber-100 text-sm mt-2 ml-4 list-disc">
            <li>Remove the worktree and all uncommitted changes</li>
            <li>Archive the branch</li>
            <li>Preserve the task description as a draft</li>
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
            <li>Preserve the task description as a draft</li>
          </ul>
        </div>
      )}
      <p className="text-slate-400 text-sm">
        The task content will be preserved and can be started again later.
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title="Convert Session to Draft"
      body={body}
      confirmText={loading ? 'Converting…' : 'Convert to Draft'}
      confirmTitle="Convert to draft (Enter)"
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