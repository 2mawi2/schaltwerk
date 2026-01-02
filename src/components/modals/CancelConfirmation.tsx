import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'

interface CancelConfirmationProps {
  open: boolean
  displayName: string
  branch: string
  hasUncommittedChanges: boolean
  onConfirm: (force: boolean) => void
  onCancel: () => void
  loading?: boolean
}

export function CancelConfirmation({ 
  open, 
  displayName,
  branch,
  hasUncommittedChanges, 
  onConfirm, 
  onCancel,
  loading = false,
}: CancelConfirmationProps) {
  const handleConfirm = useCallback(() => {
    onConfirm(hasUncommittedChanges)
  }, [onConfirm, hasUncommittedChanges])

  if (!open) return null

  const body = (
    <p className="text-secondary">
      This will move the session to the archive.
      {hasUncommittedChanges ? (
        <span className="block mt-2 text-warning font-medium">
          ⚠️ Warning: This session has uncommitted changes that will be lost!
        </span>
      ) : (
        <span className="block mt-2 text-tertiary">
          All changes in this session have been committed.
        </span>
      )}
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>Cancel Session: {displayName} ({branch})?</span>}
      body={body}
      confirmText={hasUncommittedChanges ? 'Force Cancel' : 'Cancel Session'}
      confirmTitle="Cancel session (Enter)"
      cancelText="Keep Session"
      cancelTitle="Keep session (Esc)"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant={hasUncommittedChanges ? 'danger' : 'warning'}
    />
  )
}