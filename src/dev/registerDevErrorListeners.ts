import type { DevBackendErrorPayload } from '../common/events'
import type { ToastOptions } from '../common/toast/ToastProvider'

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

  let suppressNextWindowError = false
  const handleFrontendError = (event: ErrorEvent) => {
    const description =
      describeUnknown(event.error ?? event.message ?? 'Unknown frontend error')

    suppressNextWindowError = true
    pushToast({
      tone: 'error',
      title: frontendErrorTitle,
      description,
      durationMs: 8000,
    })
  }

  const previousOnError = globalObject.onerror
  const handleWindowOnError: OnErrorEventHandler = (message, source, lineno, colno, error) => {
    if (suppressNextWindowError) {
      suppressNextWindowError = false
    } else {
      const errorCandidate = error ?? (message instanceof Event ? (message as ErrorEvent).error : null)
      const description = describeUnknown(errorCandidate ?? message ?? 'Unknown frontend error')

      pushToast({
        tone: 'error',
        title: frontendErrorTitle,
        description,
        durationMs: 8000,
      })
    }

    if (typeof previousOnError === 'function') {
      return previousOnError(message, source, lineno, colno, error)
    }

    return false
  }

  const handleUnhandledRejection = (event: PromiseRejectionEvent | Event) => {
    const rejectionEvent = event as PromiseRejectionEvent
    const description = describeUnknown(rejectionEvent.reason)

    pushToast({
      tone: 'error',
      title: promiseRejectionTitle,
      description,
      durationMs: 8000,
    })
  }

  globalObject.addEventListener('error', handleFrontendError)
  globalObject.addEventListener('unhandledrejection', handleUnhandledRejection as EventListener)
  globalObject.onerror = handleWindowOnError

  const unlistenBackend = await listenBackendError((payload) => {
    const description = describeUnknown(payload.message ?? 'Unknown backend error')
    const composedDescription = payload.source
      ? `${payload.source}\n${description}`
      : description

    pushToast({
      tone: 'error',
      title: backendErrorTitle,
      description: composedDescription,
      durationMs: 8000,
    })
  })

  return () => {
    globalObject.removeEventListener('error', handleFrontendError)
    globalObject.removeEventListener('unhandledrejection', handleUnhandledRejection as EventListener)
    if (globalObject.onerror === handleWindowOnError) {
      globalObject.onerror = previousOnError
    } else if (globalObject.onerror == null && previousOnError) {
      globalObject.onerror = previousOnError
    }
    unlistenBackend()
  }
}
