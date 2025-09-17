import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRightPanelPersistence } from '../useRightPanelPersistence'

describe('useRightPanelPersistence', () => {
  const storageKey = 'test-session'

  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('initializes with defaults when storage is empty', () => {
    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    expect(result.current.sizes).toEqual([70, 30])
    expect(result.current.isCollapsed).toBe(false)
  })

  it('loads stored values for the provided key', () => {
    window.sessionStorage.setItem(`schaltwerk:right-panel:sizes:${storageKey}`, JSON.stringify([65, 35]))
    window.sessionStorage.setItem(`schaltwerk:right-panel:collapsed:${storageKey}`, 'true')
    window.sessionStorage.setItem(`schaltwerk:right-panel:lastExpanded:${storageKey}`, '42')

    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    expect(result.current.isCollapsed).toBe(true)
    expect(result.current.sizes).toEqual([100, 0])

    act(() => {
      result.current.toggleCollapsed()
    })

    expect(result.current.isCollapsed).toBe(false)
    expect(result.current.sizes).toEqual([58, 42])
  })

  it('persists size updates and last expanded width when expanded', () => {
    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    act(() => {
      result.current.setSizes([55, 45])
    })

    expect(window.sessionStorage.getItem(`schaltwerk:right-panel:sizes:${storageKey}`)).toEqual(JSON.stringify([55, 45]))
    expect(window.sessionStorage.getItem(`schaltwerk:right-panel:lastExpanded:${storageKey}`)).toBe('45')
  })

  it('toggles collapse state and persists it', () => {
    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    act(() => {
      result.current.toggleCollapsed()
    })

    expect(result.current.isCollapsed).toBe(true)
    expect(result.current.sizes).toEqual([100, 0])
    expect(window.sessionStorage.getItem(`schaltwerk:right-panel:collapsed:${storageKey}`)).toBe('true')
    expect(window.sessionStorage.getItem(`schaltwerk:right-panel:lastExpanded:${storageKey}`)).toBe('30')

    act(() => {
      result.current.toggleCollapsed()
    })

    expect(result.current.isCollapsed).toBe(false)
    expect(result.current.sizes).toEqual([70, 30])
    expect(window.sessionStorage.getItem(`schaltwerk:right-panel:collapsed:${storageKey}`)).toBe('false')
  })

  it('supports explicit collapsed state updates', () => {
    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    act(() => {
      result.current.setCollapsedExplicit(true)
    })

    expect(result.current.isCollapsed).toBe(true)
    expect(result.current.sizes).toEqual([100, 0])

    act(() => {
      result.current.setCollapsedExplicit(false)
    })

    expect(result.current.isCollapsed).toBe(false)
    expect(result.current.sizes).toEqual([70, 30])
  })

  it('switches storage keys and restores matching state', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRightPanelPersistence({ storageKey: key }),
      { initialProps: { key: 'session-a' } }
    )

    act(() => {
      result.current.setSizes([60, 40])
      result.current.setCollapsedExplicit(true)
    })

    expect(result.current.isCollapsed).toBe(true)

    act(() => {
      rerender({ key: 'session-b' })
    })
    expect(result.current.isCollapsed).toBe(false)
    expect(result.current.sizes).toEqual([70, 30])

    act(() => {
      result.current.setSizes([52, 48])
    })

    act(() => {
      rerender({ key: 'session-a' })
    })
    expect(result.current.isCollapsed).toBe(true)
    act(() => {
      result.current.toggleCollapsed()
    })
    expect(result.current.sizes).toEqual([60, 40])
  })

  it('restores previous size when re-expanding after manual update', () => {
    const { result } = renderHook(() => useRightPanelPersistence({ storageKey }))

    act(() => {
      result.current.setSizes([62, 38])
      result.current.toggleCollapsed()
    })

    expect(result.current.isCollapsed).toBe(true)

    act(() => {
      result.current.toggleCollapsed()
    })

    expect(result.current.isCollapsed).toBe(false)
    expect(result.current.sizes).toEqual([62, 38])
  })
})
