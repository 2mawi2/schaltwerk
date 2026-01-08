import { useState, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { ConfirmModal } from './ConfirmModal'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n/useTranslation'

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
  onSuccess,
}: ConvertToDraftConfirmationProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  const handleConfirm = useCallback(async () => {
    if (loading) return

    setLoading(true)
    try {
      const result = await invoke<string | void>(TauriCommands.SchaltwerkCoreConvertSessionToDraft, {
        name: sessionName,
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
      <p className="text-slate-300 mb-4">
        {t.dialogs.convertToSpec.body.replace('{name}', '')}
        <span className="font-mono" style={{ color: 'var(--color-accent-cyan)' }}>{displayName}</span>
      </p>
      {hasUncommittedChanges && (
        <div className="bg-amber-950/50 border border-amber-800 rounded p-3 mb-4">
          <p className="text-amber-200 text-sm font-semibold mb-2">{t.dialogs.convertToSpec.warningTitle}</p>
          <p className="text-amber-100 text-sm">
            {t.dialogs.convertToSpec.warningBody}
          </p>
          <ul className="text-amber-100 text-sm mt-2 ml-4 list-disc">
            <li>{t.dialogs.convertToSpec.warningItem1}</li>
            <li>{t.dialogs.convertToSpec.warningItem2}</li>
            <li>{t.dialogs.convertToSpec.warningItem3}</li>
          </ul>
        </div>
      )}
      {!hasUncommittedChanges && (
        <div className="bg-slate-800/50 border border-slate-700 rounded p-3 mb-4">
          <p className="text-slate-300 text-sm">
            {t.dialogs.convertToSpec.normalBody}
          </p>
          <ul className="text-slate-300 text-sm mt-2 ml-4 list-disc">
            <li>{t.dialogs.convertToSpec.normalItem1}</li>
            <li>{t.dialogs.convertToSpec.warningItem2}</li>
            <li>{t.dialogs.convertToSpec.warningItem3}</li>
          </ul>
        </div>
      )}
      <p className="text-slate-400 text-sm">
        {t.dialogs.convertToSpec.footnote}
      </p>
    </div>
  )

  return (
    <ConfirmModal
      open={open}
      title={t.dialogs.convertToSpec.title}
      body={body}
      confirmText={t.dialogs.convertToSpec.confirm}
      confirmTitle={t.dialogs.convertToSpec.confirmTitle}
      cancelText={t.dialogs.convertToSpec.cancel}
      cancelTitle={t.dialogs.convertToSpec.cancelTitle}
      onConfirm={() => { void handleConfirm() }}
      onCancel={onClose}
      confirmDisabled={loading}
      variant="warning"
    />
  )
}
