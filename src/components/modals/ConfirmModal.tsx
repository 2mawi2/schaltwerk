import { useEffect, useCallback, useRef } from 'react'

interface ConfirmModalProps {
  open: boolean
  title: React.ReactNode
  body?: React.ReactNode
  confirmText: React.ReactNode
  cancelText?: string
  confirmTitle?: string
  cancelTitle?: string
  onConfirm: () => void
  onCancel: () => void
  confirmDisabled?: boolean
  loading?: boolean
  variant?: 'default' | 'danger' | 'warning' | 'success'
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmText,
  cancelText = 'Cancel',
  confirmTitle,
  cancelTitle,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  loading = false,
  variant = 'default',
}: ConfirmModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = useCallback(() => {
    if (loading || confirmDisabled) return
    onConfirm()
  }, [loading, confirmDisabled, onConfirm])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        handleConfirm()
      }
    }

    // Use capture phase to handle events before other listeners
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel, handleConfirm])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      confirmButtonRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  if (!open) return null

  const confirmBaseClasses = 'px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 group disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2'
  const confirmVariantClasses =
    variant === 'danger'
      ? 'bg-red-700 hover:bg-red-600 focus:ring-red-500'
      : variant === 'warning'
      ? 'bg-amber-700 hover:bg-amber-600 focus:ring-amber-500'
      : variant === 'success'
      ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
      : 'bg-slate-700 hover:bg-slate-600 focus:ring-slate-500'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4 text-slate-100">{title}</h2>
        {body && <div className="mb-6">{body}</div>}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 group"
            title={cancelTitle || 'Cancel (Esc)'}
          >
            {cancelText}
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          <button
            ref={confirmButtonRef}
            onClick={handleConfirm}
            disabled={loading || confirmDisabled}
            className={`${confirmBaseClasses} ${confirmVariantClasses}`}
            title={confirmTitle || 'Confirm (Enter)'}
          >
            {loading && (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                aria-hidden="true"
              />
            )}
            <span>{confirmText}</span>
            {!loading && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
