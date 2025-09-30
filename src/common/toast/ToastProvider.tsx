import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { theme } from '../theme'
import { makeId, calculateToastOverflow } from './toastUtils'
import { logger } from '../../utils/logger'

export interface ToastOptions {
  tone: 'success' | 'warning' | 'error'
  title: string
  description?: string
  durationMs?: number
}

interface ToastEntry extends ToastOptions {
  id: string
}

interface ToastContextValue {
  pushToast: (options: ToastOptions) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const timersRef = useRef(new Map<string, number>())

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
    const timeoutId = timersRef.current.get(id)
    if (timeoutId) {
      window.clearTimeout(timeoutId)
      timersRef.current.delete(id)
    }
  }, [])

  const pushToast = useCallback((options: ToastOptions) => {
    const id = makeId()
    const entry: ToastEntry = { ...options, id }
    const duration = options.durationMs ?? 4000

    logger.info(
      '[ToastProvider] enqueue toast',
      JSON.stringify({ id, tone: entry.tone, title: entry.title, hasDescription: Boolean(entry.description) })
    )

    const removedIds: string[] = []
    setToasts((prev) => {
      const next = [...prev, entry]
      const result = calculateToastOverflow(next, 3)
      removedIds.push(...result.removedIds)
      return result.toasts as ToastEntry[]
    })

    if (removedIds.length > 0) {
      logger.debug(
        '[ToastProvider] dropped overflowing toasts',
        JSON.stringify({ count: removedIds.length, removedIds })
      )
    }

    removedIds.forEach((removedId) => {
      const timeoutId = timersRef.current.get(removedId)
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        timersRef.current.delete(removedId)
      }
    })

    if (duration > 0 && typeof window !== 'undefined') {
      const timeoutId = window.setTimeout(() => dismissToast(id), duration)
      timersRef.current.set(id, timeoutId)
    }
  }, [dismissToast])

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-full max-w-sm flex-col gap-2 px-2"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => {
            const background = toast.tone === 'success'
              ? theme.colors.accent.green.dark
              : toast.tone === 'warning'
                ? theme.colors.accent.yellow.dark
                : theme.colors.accent.red.dark
            const border = toast.tone === 'success'
              ? theme.colors.accent.green.DEFAULT
              : toast.tone === 'warning'
                ? theme.colors.accent.yellow.DEFAULT
                : theme.colors.accent.red.DEFAULT

            return (
              <div
                key={toast.id}
                className="pointer-events-auto overflow-hidden rounded-md shadow-lg"
                style={{
                  backgroundColor: background,
                  border: `1px solid ${border}`,
                }}
              >
                <div className="flex items-start gap-2 px-3 py-2 text-sm" style={{ color: theme.colors.text.primary }}>
                  <div className="flex-1">
                    <div className="font-semibold leading-tight">{toast.title}</div>
                    {toast.description && (
                      <div className="mt-0.5 text-xs opacity-80 leading-snug">{toast.description}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
                    onClick={() => dismissToast(toast.id)}
                    className="ml-1 rounded p-1 text-xs transition-colors duration-150"
                    style={{
                      color: theme.colors.text.secondary,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

export function useOptionalToast() {
  return useContext(ToastContext)
}
