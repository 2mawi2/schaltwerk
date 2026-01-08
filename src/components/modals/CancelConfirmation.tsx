import { useCallback } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { useTranslation } from '../../common/i18n/useTranslation'

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
  const { t } = useTranslation()
  const handleConfirm = useCallback(() => {
    onConfirm(hasUncommittedChanges)
  }, [onConfirm, hasUncommittedChanges])

  if (!open) return null

  const title = t.dialogs.cancelSession.title
    .replace('{name}', displayName)
    .replace('{branch}', branch)

  const body = (
    <p className="text-zinc-300">
      {t.dialogs.cancelSession.body}
      {hasUncommittedChanges ? (
        <span className="block mt-2 text-amber-500 font-medium">
          ⚠️ {t.dialogs.cancelSession.warningUncommitted}
        </span>
      ) : (
        <span className="block mt-2 text-zinc-400">
          {t.dialogs.cancelSession.allCommitted}
        </span>
      )}
    </p>
  )

  return (
    <ConfirmModal
      open={open}
      title={<span>{title}</span>}
      body={body}
      confirmText={hasUncommittedChanges ? t.dialogs.cancelSession.forceCancel : t.dialogs.cancelSession.cancelSession}
      cancelText={t.dialogs.cancelSession.keepSession}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      loading={loading}
      variant={hasUncommittedChanges ? 'danger' : 'warning'}
    />
  )
}