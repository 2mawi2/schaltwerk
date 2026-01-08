import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { useTranslation } from '../../common/i18n/useTranslation'

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
  const { t } = useTranslation()
  const handleConfirm = useCallback(() => {
    onConfirm()
  }, [onConfirm])

  if (!open) return null

  const title = t.dialogs.deleteSpec.title.replace('{name}', displayName)

  const body = (
    <p className="text-zinc-300">
      {t.dialogs.deleteSpec.body}
      <span className="block mt-2 text-zinc-400">
        {t.dialogs.deleteSpec.bodyNote}
      </span>
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>{title}</span>}
      body={body}
      confirmText={t.dialogs.deleteSpec.confirm}
      confirmTitle={t.dialogs.deleteSpec.confirmTitle}
      cancelText={t.dialogs.deleteSpec.cancel}
      cancelTitle={t.dialogs.deleteSpec.cancelTitle}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant="danger"
    />
  )
}
