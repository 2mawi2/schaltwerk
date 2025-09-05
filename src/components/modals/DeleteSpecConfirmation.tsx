import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'

interface DeleteDraftConfirmationProps {
  open: boolean
  displayName: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function DeleteSpecConfirmation({ 
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
      This will archive the spec prompt so you can recover it later from Settings → Archives.
      <span className="block mt-2 text-zinc-400">
        You can permanently delete it from the archive if desired.
      </span>
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>Delete Spec: {displayName}?</span>}
      body={body}
      confirmText="Archive Spec"
      confirmTitle="Archive spec (Enter)"
      cancelText="Keep Spec"
      cancelTitle="Keep spec (Esc)"
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant="danger"
    />
  )
}
