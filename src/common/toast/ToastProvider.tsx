import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { makeId, calculateToastOverflow } from './toastUtils'
import { logger } from '../../utils/logger'
import { ToastCard } from './ToastCard'

export interface ToastOptions {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
  durationMs?: number
  action?: {
    label: string
    onClick: () => void
  }
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
          className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-full max-w-sm flex-col gap-3 px-2"
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((toast) => (
            <ToastCard
              key={toast.id}
              tone={toast.tone}
              title={toast.title}
              description={toast.description}
              action={toast.action ? {
                label: toast.action.label,
                onClick: () => {
                  try {
                    toast.action?.onClick()
                  } catch (error) {
                    logger.warn('Toast action failed', error)
                  } finally {
                    dismissToast(toast.id)
                  }
                }
              } : undefined}
              onDismiss={() => dismissToast(toast.id)}
            />
          ))}
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
