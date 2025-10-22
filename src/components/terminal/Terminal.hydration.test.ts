import { describe, it, expect, vi } from 'vitest'
import { hydrateReusedTerminal } from './hydration'

const createRefs = (hydrated: boolean, hydratedOnce: boolean) => ({
  hydratedRef: { current: hydrated },
  hydratedOnceRef: { current: hydratedOnce },
})

describe('hydrateReusedTerminal', () => {
  it('marks a reused terminal as hydrated and notifies onReady', () => {
    const setHydrated = vi.fn()
    const onReady = vi.fn()
    const { hydratedRef, hydratedOnceRef } = createRefs(false, false)

    const result = hydrateReusedTerminal({
      isNew: false,
      hydratedRef,
      hydratedOnceRef,
      setHydrated,
      onReady,
    })

    expect(result).toBe(true)
    expect(hydratedRef.current).toBe(true)
    expect(hydratedOnceRef.current).toBe(true)
    expect(setHydrated).toHaveBeenCalledWith(true)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('skips hydration when terminal is already marked hydrated', () => {
    const setHydrated = vi.fn()
    const onReady = vi.fn()
    const { hydratedRef, hydratedOnceRef } = createRefs(true, true)

    const result = hydrateReusedTerminal({
      isNew: false,
      hydratedRef,
      hydratedOnceRef,
      setHydrated,
      onReady,
    })

    expect(result).toBe(false)
    expect(setHydrated).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
  })

  it('does nothing for brand new terminals', () => {
    const setHydrated = vi.fn()
    const { hydratedRef, hydratedOnceRef } = createRefs(false, false)

    const result = hydrateReusedTerminal({
      isNew: true,
      hydratedRef,
      hydratedOnceRef,
      setHydrated,
      onReady: undefined,
    })

    expect(result).toBe(false)
    expect(setHydrated).not.toHaveBeenCalled()
    expect(hydratedRef.current).toBe(false)
    expect(hydratedOnceRef.current).toBe(false)
  })
})
