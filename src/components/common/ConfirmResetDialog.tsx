import { AnimatedText } from './AnimatedText'

interface ConfirmResetDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  isBusy?: boolean
}

export function ConfirmResetDialog({ open, onConfirm, onCancel, isBusy }: ConfirmResetDialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-overlay" onClick={onCancel} />
      <div className="relative bg-elevated border-default rounded-lg p-4 w-[460px] shadow-xl">
        <div className="text-primary font-semibold mb-1">Reset Session Worktree</div>
        <div className="text-secondary text-sm mb-3">
          This will discard ALL uncommitted changes and reset this session branch to its base branch. This action cannot be undone.
        </div>
        {isBusy ? (
          <div className="py-2 text-secondary"><AnimatedText text="resetting" size="xs" /></div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 bg-secondary hover:bg-secondary-hover rounded text-sm">Cancel</button>
            <button onClick={onConfirm} className="px-3 py-1.5 bg-accent-red hover:bg-accent-red-light rounded text-sm font-medium">Reset</button>
          </div>
        )}
      </div>
    </div>
  )
}
