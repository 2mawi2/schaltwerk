import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalResizeCoordinator } from './resize/TerminalResizeCoordinator'

function createCoordinator(overrides: Partial<ConstructorParameters<typeof TerminalResizeCoordinator>[0]> = {}) {
  const applyResize = vi.fn()
  const applyRows = vi.fn()
  const idleCallbacks: Array<() => void> = []
  const coordinator = new TerminalResizeCoordinator({
    debounceDelay: 100,
    smallBufferThreshold: 200,
    getBufferLength: () => 500,
    isVisible: () => true,
    applyResize,
    applyRows,
    scheduleIdle: (cb) => {
      idleCallbacks.push(cb)
      return idleCallbacks.length - 1
    },
    cancelIdle: (handle) => {
      idleCallbacks[handle] = () => {}
    },
    ...overrides,
  })
  return { coordinator, applyResize, applyRows, idleCallbacks }
}

describe('TerminalResizeCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bypasses debounce when immediate is true', () => {
    const { coordinator, applyResize, applyRows } = createCoordinator()

    coordinator.resize({ cols: 120, rows: 40, reason: 'immediate', immediate: true })

    expect(applyResize).toHaveBeenCalledTimes(1)
    expect(applyResize).toHaveBeenCalledWith(120, 40, expect.objectContaining({
      reason: 'immediate',
      force: true,
      source: 'both'
    }))
    expect(applyRows).not.toHaveBeenCalled()
  })

  it('dispatches rows immediately and columns after debounce when visible', () => {
    const { coordinator, applyResize, applyRows } = createCoordinator()

    coordinator.resize({ cols: 150, rows: 60, reason: 'visible' })

    expect(applyRows).toHaveBeenCalledTimes(1)
    expect(applyRows).toHaveBeenCalledWith(150, 60, expect.objectContaining({
      reason: 'visible',
      force: true,
      source: 'rows'
    }))
    expect(applyResize).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(applyResize).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(applyResize).toHaveBeenCalledTimes(1)
    expect(applyResize).toHaveBeenCalledWith(150, 60, expect.objectContaining({
      reason: 'visible',
      force: true,
      source: 'debounce'
    }))
  })

  it('applies resize immediately when buffer is below threshold', () => {
    const { coordinator, applyResize, applyRows } = createCoordinator({
      getBufferLength: () => 10
    })

    coordinator.resize({ cols: 100, rows: 30, reason: 'small-buffer' })

    expect(applyResize).toHaveBeenCalledTimes(1)
    expect(applyResize).toHaveBeenCalledWith(100, 30, expect.objectContaining({
      reason: 'small-buffer',
      force: true,
      source: 'both'
    }))
    expect(applyRows).not.toHaveBeenCalled()
  })

  it('schedules resize on idle when not visible', () => {
    const idleCallbacks: Array<() => void> = []
    const { coordinator, applyResize, applyRows } = createCoordinator({
      isVisible: () => false,
      scheduleIdle: (cb) => {
        idleCallbacks.push(cb)
        return idleCallbacks.length - 1
      },
      cancelIdle: (handle) => {
        idleCallbacks[handle] = () => {}
      }
    })

    coordinator.resize({ cols: 140, rows: 55, reason: 'hidden' })

    expect(applyRows).not.toHaveBeenCalled()
    expect(applyResize).not.toHaveBeenCalled()
    expect(idleCallbacks.length).toBe(1)

    idleCallbacks[0]()

    expect(applyResize).toHaveBeenCalledTimes(1)
    expect(applyResize).toHaveBeenCalledWith(140, 55, expect.objectContaining({
      reason: 'hidden',
      force: true,
      source: 'idle'
    }))
  })

  it('flushes pending resize work', () => {
    const { coordinator, applyResize } = createCoordinator()

    coordinator.resize({ cols: 180, rows: 70, reason: 'flushable' })
    expect(applyResize).not.toHaveBeenCalled()

    coordinator.flush('flush')
    expect(applyResize).toHaveBeenCalledTimes(1)
    expect(applyResize).toHaveBeenCalledWith(180, 70, expect.objectContaining({
      reason: 'flush',
      force: true,
      source: 'flush'
    }))
  })
})
