import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'

interface DeleteDraftConfirmationProps {
  open: boolean
  displayName: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function DeletePlanConfirmation({ 
  open, 
  displayName,
  onConfirm, 
  onCancel,
  loading = false,
}: DeleteDraftConfirmationProps) {
  const handleConfirm = useCallback(() => {
    onConfirm()
  }, [onConfirm])

  if (!open) return null

  const body = (
    <p className="text-zinc-300">
      This will permanently delete the plan session.
      <span className="block mt-2 text-zinc-400">
        This action cannot be undone.
      </span>
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>Delete Plan: {displayName}?</span>}
      body={body}
      confirmText="Delete Plan"
      confirmTitle="Delete plan (Enter)"
      cancelText="Keep Plan"
      cancelTitle="Keep plan (Esc)"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant="danger"
    />
  )
}