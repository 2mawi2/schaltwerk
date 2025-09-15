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
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-slate-900 border border-slate-700 rounded-lg p-4 w-[460px] shadow-xl">
        <div className="text-slate-100 font-semibold mb-1">Reset Session Worktree</div>
        <div className="text-slate-300 text-sm mb-3">
          This will discard ALL uncommitted changes and reset this session branch to its base branch. This action cannot be undone.
        </div>
        {isBusy ? (
          <div className="py-2 text-slate-300"><AnimatedText text="resetting" size="md" /></div>
        ) : (
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm">Cancel</button>
            <button onClick={onConfirm} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium">Reset</button>
          </div>
        )}
      </div>
    </div>
  )
}
