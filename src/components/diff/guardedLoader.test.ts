import { describe, it, expect, vi } from 'vitest'
import { createGuardedLoader } from './guardedLoader'

const flushPromises = () => new Promise<void>(resolve => queueMicrotask(() => resolve()))

describe('createGuardedLoader', () => {
  it('runs the loader immediately on first trigger', async () => {
    const loader = vi.fn().mockResolvedValue(undefined)
    const guarded = createGuardedLoader(loader)

    await guarded.run()

    expect(loader).toHaveBeenCalledTimes(1)
    expect(guarded.getState()).toEqual({ inFlight: false, pending: false })
  })

  it('coalesces overlapping triggers into one additional run', async () => {
    let resolveFirst: () => void = () => {}
    const loader = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve }))
      .mockImplementation(() => Promise.resolve())
    const guarded = createGuardedLoader(loader)

    const first = guarded.run()
    await flushPromises()
    // Second trigger while first load is still in-flight
    const second = guarded.run()

    expect(loader).toHaveBeenCalledTimes(1)
    expect(guarded.getState()).toEqual({ inFlight: true, pending: true })

    resolveFirst()
    await first
    await second
    await flushPromises()

    // After first completes, pending trigger causes exactly one more run
    expect(loader).toHaveBeenCalledTimes(2)
    expect(guarded.getState()).toEqual({ inFlight: false, pending: false })
  })

  it('does not loop when loader throws', async () => {
    const err = new Error('boom')
    const loader = vi.fn().mockRejectedValue(err)
    const guarded = createGuardedLoader(loader)

    await expect(guarded.run()).rejects.toThrow(err)
    expect(guarded.getState()).toEqual({ inFlight: false, pending: false })
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
