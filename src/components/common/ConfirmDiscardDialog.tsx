import { AnimatedText } from './AnimatedText'
import { useTranslation } from '../../common/i18n'

interface ConfirmDiscardDialogProps {
  open: boolean
  filePath: string | null
  onConfirm: () => void
  onCancel: () => void
  isBusy?: boolean
}

export function ConfirmDiscardDialog({ open, filePath, onConfirm, onCancel, isBusy }: ConfirmDiscardDialogProps) {
  const { t } = useTranslation()
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-lg p-4 w-[480px] shadow-xl">
        <div className="text-slate-100 font-semibold mb-1">{t.dialogs.discardFile.title}</div>
        <div className="text-slate-300 text-sm mb-3">
          {t.dialogs.discardFile.body}
          <div className="mt-1 text-slate-200 font-mono text-xs break-all">{filePath}</div>
          {t.dialogs.discardFile.cannotUndo}
        </div>
        {isBusy ? (
          <div className="py-2 text-slate-300"><AnimatedText text="deleting" size="md" /></div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm">{t.dialogs.discardFile.cancel}</button>
            <button onClick={onConfirm} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium">{t.dialogs.discardFile.discard}</button>
          </div>
        )}
      </div>
    </div>
  )
}

