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
        const target = e.target as HTMLElement
        const isInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

        if (!isInputField) {
          e.preventDefault()
          e.stopPropagation()
          handleConfirm()
        }
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

  const confirmBaseClasses = 'px-4 py-2 text-sm font-medium text-inverse rounded-md focus:outline-none focus:ring-2 group disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2'
  const confirmVariantClasses =
    variant === 'danger'
      ? 'bg-accent-red hover:bg-accent-red-dark focus:ring-border-focus'
      : variant === 'warning'
      ? 'bg-accent-amber hover:bg-accent-amber-dark focus:ring-border-focus'
      : variant === 'success'
      ? 'bg-accent-green hover:bg-accent-green-dark focus:ring-border-focus'
      : 'bg-secondary hover:bg-hover focus:ring-border-focus'

  return (
    <div className="fixed inset-0 bg-overlay-backdrop flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div
        className="bg-elevated border border-subtle rounded-lg p-6 max-w-md w-full mx-4"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4 text-primary">{title}</h2>
        {body && <div className="mb-6">{body}</div>}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-secondary bg-secondary border border-subtle rounded-md hover:bg-hover focus:outline-none focus:ring-2 focus:ring-border-focus group"
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
            <span>{confirmText}</span>
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
          </button>
        </div>
      </div>
    </div>
  )
}
