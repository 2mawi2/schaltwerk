import { AnimatedText } from './AnimatedText'

interface ConfirmDiscardDialogProps {
  open: boolean
  filePath: string | null
  onConfirm: () => void
  onCancel: () => void
  isBusy?: boolean
}

export function ConfirmDiscardDialog({ open, filePath, onConfirm, onCancel, isBusy }: ConfirmDiscardDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-overlay" onClick={onCancel} />
      <div className="relative bg-elevated border-default rounded-lg p-4 w-[480px] shadow-xl">
        <div className="text-primary font-semibold mb-1">Discard File Changes</div>
        <div className="text-secondary text-sm mb-3">
          This will discard all uncommitted changes for the file:
          <div className="mt-1 text-primary font-mono text-xs break-all">{filePath}</div>
          This action cannot be undone.
        </div>
        {isBusy ? (
          <div className="py-2 text-secondary"><AnimatedText text="deleting" size="md" /></div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 bg-secondary hover:bg-secondary-hover rounded text-sm">Cancel</button>
            <button onClick={onConfirm} className="px-3 py-1.5 bg-accent-red hover:bg-accent-red-light rounded text-sm font-medium">Discard</button>
          </div>
        )}
      </div>
    </div>
  )
}

