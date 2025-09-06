import { useState, useMemo, useEffect } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { SessionVersionGroup } from '../../utils/sessionVersions'
import { invoke } from '@tauri-apps/api/core'

interface SessionPreferences {
  auto_commit_on_review: boolean
  skip_confirmation_modals: boolean
}

interface PromoteVersionConfirmationProps {
  open: boolean
  versionGroup: SessionVersionGroup | null
  selectedSessionId: string
  onClose: () => void
  onConfirm: () => void
}

export function PromoteVersionConfirmation({
  open,
  versionGroup,
  selectedSessionId,
  onClose,
  onConfirm
}: PromoteVersionConfirmationProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [shouldSkipDialog, setShouldSkipDialog] = useState(false)
  const [checkingPreference, setCheckingPreference] = useState(true)

  // Check if we should skip the dialog based on user preferences
  useEffect(() => {
    if (open) {
      // Reset checkbox state when modal opens
      setDontAskAgain(false)
      setCheckingPreference(true)
      
      invoke<SessionPreferences>('get_session_preferences')
        .then(preferences => {
          if (preferences?.skip_confirmation_modals) {
            // If skip is enabled, immediately confirm and close
            setShouldSkipDialog(true)
            onConfirm()
            onClose() // Also close to reset the modal state
          } else {
            // Show the dialog
            setShouldSkipDialog(false)
          }
          setCheckingPreference(false)
        })
        .catch(() => {
          // If failed to load preferences, show the dialog
          setShouldSkipDialog(false)
          setCheckingPreference(false)
        })
    }
  }, [open, onConfirm, onClose])

  const { sessionToKeep, sessionsToDelete } = useMemo(() => {
    if (!versionGroup || !selectedSessionId) {
      return { sessionToKeep: null, sessionsToDelete: [] }
    }

    const keepSession = versionGroup.versions.find(v => v.session.info.session_id === selectedSessionId)
    const deleteVersions = versionGroup.versions.filter(v => v.session.info.session_id !== selectedSessionId)

    return {
      sessionToKeep: keepSession,
      sessionsToDelete: deleteVersions
    }
  }, [versionGroup, selectedSessionId])

  // Don't render if no data, or if we're checking preference, or if we should skip
  if (!versionGroup || !sessionToKeep || checkingPreference || shouldSkipDialog) {
    return null
  }

  const handleConfirm = async () => {
    // Store the "don't ask again" preference globally (not per project)
    if (dontAskAgain) {
      try {
        const preferences = await invoke<SessionPreferences>('get_session_preferences')
        await invoke('set_session_preferences', { 
          preferences: {
            ...preferences,
            skip_confirmation_modals: true
          }
        })
      } catch (error) {
        console.error('Failed to save preference:', error)
      }
    }
    onConfirm()
  }

  return (
    <ConfirmModal
      open={open}
      title={`Promote "${sessionToKeep.session.info.session_id}" as best version?`}
      body={
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-300 mb-3">
              This will permanently delete the following sessions:
            </p>
            <ul className="space-y-1 text-sm text-slate-400 bg-slate-800/50 rounded p-3 border border-slate-700">
              {sessionsToDelete.map((version) => (
                <li key={version.session.info.session_id} className="flex items-center gap-2">
                  <span className="text-red-400">•</span>
                  <span className="font-mono">{version.session.info.session_id}</span>
                  <span className="text-xs text-slate-500">
                    (v{version.versionNumber})
                  </span>
                </li>
              ))}
            </ul>
          </div>
          
          <div>
            <p className="text-sm text-slate-300 mb-2">
              The selected session will remain in <strong>Running</strong> state for continued work.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dont-ask-again"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
            />
            <label htmlFor="dont-ask-again" className="text-xs text-slate-400">
              Don't ask again
            </label>
          </div>
        </div>
      }
      confirmText="Delete Others"
      cancelText="Cancel"
      onConfirm={handleConfirm}
      onCancel={onClose}
      variant="warning"
    />
  )
}