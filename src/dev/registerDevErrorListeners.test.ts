import { describe, it, expect, vi, afterEach } from 'vitest'
import { logger } from '../utils/logger'
import { registerDevErrorListeners, type DevBackendErrorPayload } from './registerDevErrorListeners'

describe('registerDevErrorListeners', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when not in dev mode', async () => {
    const pushToast = vi.fn()
    const listenBackendError = vi.fn(async () => vi.fn())

    const cleanup = await registerDevErrorListeners({
      isDev: false,
      pushToast,
      listenBackendError,
    })

    expect(listenBackendError).not.toHaveBeenCalled()

    const error = new Error('frontend boom')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    await Promise.resolve()

    expect(pushToast).not.toHaveBeenCalled()

    cleanup()
  })

  it('shows a toast for frontend errors in dev mode', async () => {
    const pushToast = vi.fn()
    const listenBackendError = vi.fn(async () => vi.fn())

    const cleanup = await registerDevErrorListeners({
      isDev: true,
      pushToast,
      listenBackendError,
    })

    const error = new Error('frontend explosion')
    window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }))
    await Promise.resolve()

    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      title: 'Frontend Error',
    }))

    cleanup()
  })

  it('shows a toast for unhandled promise rejections in dev mode', async () => {
    const pushToast = vi.fn()
    const listenBackendError = vi.fn(async () => vi.fn())

    const cleanup = await registerDevErrorListeners({
      isDev: true,
      pushToast,
      listenBackendError,
    })

    const rejection = new Error('promise rejection')
    const promise = Promise.resolve()
    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.assign(event, { reason: rejection, promise })
    window.dispatchEvent(event)
    await Promise.resolve()

    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      title: 'Unhandled Promise Rejection',
    }))

    cleanup()
  })

  it('wires backend error events to error toasts', async () => {
    const pushToast = vi.fn()
    let backendHandler: ((payload: DevBackendErrorPayload) => void) | undefined
    const unlisten = vi.fn()

    const listenBackendError = vi.fn(async (handler: (payload: DevBackendErrorPayload) => void) => {
      backendHandler = handler
      return unlisten
    })

    const cleanup = await registerDevErrorListeners({
      isDev: true,
      pushToast,
      listenBackendError,
    })

    backendHandler?.({ message: 'database failed' })
    await Promise.resolve()

    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      title: 'Backend Error',
    }))

    cleanup()
    expect(unlisten).toHaveBeenCalled()
  })

  it('falls back to window.onerror when necessary', async () => {
    const pushToast = vi.fn()
    const listenBackendError = vi.fn(async () => vi.fn())

    const cleanup = await registerDevErrorListeners({
      isDev: true,
      pushToast,
      listenBackendError,
    })

    const handler = window.onerror
    expect(handler).toBeTypeOf('function')

    handler?.('legacy message', 'source.js', 10, 12, undefined)
    await Promise.resolve()

    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'error',
      title: 'Frontend Error',
    }))

    cleanup()
  })

  it('logs and suppresses backend unlisten errors', async () => {
    const pushToast = vi.fn()
    const unlisten = vi.fn(() => Promise.reject(new Error('stop listening failed')))
    const listenBackendError = vi.fn(async () => unlisten)
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    const cleanup = await registerDevErrorListeners({
      isDev: true,
      pushToast,
      listenBackendError,
    })

    cleanup()
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[registerDevErrorListeners] Failed to unlisten dev backend errors',
      expect.any(Error)
    )
  })
})
