import type { DevBackendErrorPayload } from '../common/events'
import type { ToastOptions } from '../common/toast/ToastProvider'
import { logger } from '../utils/logger'

export type { DevBackendErrorPayload }

interface RegisterDevErrorListenersOptions {
  isDev: boolean
  pushToast: (options: ToastOptions) => void
  listenBackendError: (
    handler: (payload: DevBackendErrorPayload) => void
  ) => Promise<() => void>
  globalObject?: Window & typeof globalThis
  frontendErrorTitle?: string
  backendErrorTitle?: string
  promiseRejectionTitle?: string
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message ?? value.toString()
  }
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch (error) {
      return `Unserializable object: ${(error as Error)?.message ?? String(error)}`
    }
  }
  if (typeof value === 'undefined') {
    return 'undefined'
  }
  return String(value)
}

export async function registerDevErrorListeners(
  options: RegisterDevErrorListenersOptions
): Promise<() => void> {
  const {
    isDev,
    pushToast,
    listenBackendError,
    globalObject = typeof window !== 'undefined' ? window : undefined,
    frontendErrorTitle = 'Frontend Error',
    backendErrorTitle = 'Backend Error',
    promiseRejectionTitle = 'Unhandled Promise Rejection',
  } = options

  if (!isDev) {
    return () => {}
  }

  if (!globalObject) {
    return () => {}
  }

  const toastState = {
    frontend: { lastDescription: null as string | null, shownCount: 0 },
    rejection: { lastDescription: null as string | null, shownCount: 0 },
    backend: { lastDescription: null as string | null, shownCount: 0 },
  }

  const MAX_UNIQUE_TOASTS_PER_KIND = 3

  const pushDedupedToast = (kind: keyof typeof toastState, title: string, description: string) => {
    const state = toastState[kind]

    if (description === state.lastDescription) {
      return
    }

    state.lastDescription = description
    if (state.shownCount >= MAX_UNIQUE_TOASTS_PER_KIND) {
      logger.warn('[registerDevErrorListeners] Suppressing dev error toast (limit reached)', {
        title,
        kind,
      })
      return
    }

    state.shownCount += 1
    logger.error('[registerDevErrorListeners] Dev error captured', { title, kind, description })
    pushToast({
      tone: 'error',
      title,
      description,
      durationMs: 8000,
    })
  }

  let suppressNextWindowError = false
  const handleFrontendError = (event: ErrorEvent) => {
    const description =
      describeUnknown(event.error ?? event.message ?? 'Unknown frontend error')

    suppressNextWindowError = true
    pushDedupedToast('frontend', frontendErrorTitle, description)
  }

  const previousOnError = globalObject.onerror
  const handleWindowOnError: OnErrorEventHandler = (message, source, lineno, colno, error) => {
    if (suppressNextWindowError) {
      suppressNextWindowError = false
    } else {
      const errorCandidate = error ?? (message instanceof Event ? (message as ErrorEvent).error : null)
      const description = describeUnknown(errorCandidate ?? message ?? 'Unknown frontend error')

      pushDedupedToast('frontend', frontendErrorTitle, description)
    }

    if (typeof previousOnError === 'function') {
      return previousOnError(message, source, lineno, colno, error)
    }

    return false
  }

  const handleUnhandledRejection = (event: PromiseRejectionEvent | Event) => {
    const rejectionEvent = event as PromiseRejectionEvent
    const description = describeUnknown(rejectionEvent.reason)

    pushDedupedToast('rejection', promiseRejectionTitle, description)
  }

  globalObject.addEventListener('error', handleFrontendError)
  globalObject.addEventListener('unhandledrejection', handleUnhandledRejection as EventListener)
  globalObject.onerror = handleWindowOnError

  const unlistenBackend = await listenBackendError((payload) => {
    const description = describeUnknown(payload.message ?? 'Unknown backend error')
    const composedDescription = payload.source
      ? `${payload.source}\n${description}`
      : description

    pushDedupedToast('backend', backendErrorTitle, composedDescription)
  })

  return () => {
    globalObject.removeEventListener('error', handleFrontendError)
    globalObject.removeEventListener('unhandledrejection', handleUnhandledRejection as EventListener)
    if (globalObject.onerror === handleWindowOnError) {
      globalObject.onerror = previousOnError
    } else if (globalObject.onerror == null && previousOnError) {
      globalObject.onerror = previousOnError
    }
    try {
      const unlistenResult = unlistenBackend()
      if (
        typeof unlistenResult === 'object' &&
        unlistenResult !== null &&
        typeof (unlistenResult as Promise<unknown>).catch === 'function'
      ) {
        ;(unlistenResult as Promise<unknown>).catch((error) => {
          logger.warn('[registerDevErrorListeners] Failed to unlisten dev backend errors', error)
        })
      }
    } catch (error) {
      logger.warn('[registerDevErrorListeners] Failed to unlisten dev backend errors', error)
    }
  }
}
