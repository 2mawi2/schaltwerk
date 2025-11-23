import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'

// Provide minimal storage mocks when the test environment is node (no jsdom)
const ensureStorage = () => {
  if (typeof globalThis.localStorage !== 'undefined') return
  const createStorage = () => {
    const map = new Map<string, string>()
    return {
      get length() { return map.size },
      clear: () => map.clear(),
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) },
      key: (index: number) => Array.from(map.keys())[index] ?? null,
    }
  }

  const local = createStorage()
  const session = createStorage()

  globalThis.localStorage = local
  globalThis.sessionStorage = session
  // Provide a minimal window shim that points to the same storages
  globalThis.window = globalThis as typeof globalThis & Window
}

ensureStorage()

// JSDOM provides window/localStorage; clear between tests
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

const loadAtoms = async () => {
  if (typeof vi.resetModules === 'function') {
    await vi.resetModules()
  }
  return import('./layout')
}

describe('layout atoms persistence', () => {
  it('loads defaults when storage is empty', async () => {
    const atoms = await loadAtoms()
    const store = createStore()
    expect(store.get(atoms.leftPanelSizesAtom)).toEqual([20, 80])
    expect(store.get(atoms.rightPanelSizesAtom)).toEqual([70, 30])
    expect(store.get(atoms.leftPanelCollapsedAtom)).toBe(false)
    expect(store.get(atoms.rightPanelCollapsedAtom)).toBe(false)
  })

  it('migrates existing sessionStorage values into localStorage', async () => {
    sessionStorage.setItem('schaltwerk:layout:rightPanelSizes', JSON.stringify([60, 40]))
    sessionStorage.setItem('schaltwerk:layout:leftPanelSizes', JSON.stringify([30, 70]))
    sessionStorage.setItem('schaltwerk:layout:rightPanelCollapsed', 'true')
    sessionStorage.setItem('schaltwerk:layout:leftPanelLastExpandedSizes', JSON.stringify([25, 75]))

    const atoms = await loadAtoms()
    const store = createStore()
    const loadedRightSizes = store.get(atoms.rightPanelSizesAtom)
    expect([[60, 40], [70, 30]]).toContainEqual(loadedRightSizes)
    expect(store.get(atoms.leftPanelSizesAtom)).toEqual([30, 70])
    expect(store.get(atoms.rightPanelCollapsedAtom)).toBe(true)
    expect(store.get(atoms.leftPanelLastExpandedSizesAtom)).toEqual([25, 75])

    // migrated copies should now live in localStorage
    expect(localStorage.getItem('schaltwerk:layout:rightPanelSizes')).toBe(JSON.stringify([60, 40]))
    expect(localStorage.getItem('schaltwerk:layout:leftPanelSizes')).toBe(JSON.stringify([30, 70]))
    expect(localStorage.getItem('schaltwerk:layout:rightPanelCollapsed')).toBe('true')
    expect(localStorage.getItem('schaltwerk:layout:leftPanelLastExpandedSizes')).toBe(JSON.stringify([25, 75]))
  })

  it('persists updates back to localStorage', async () => {
    const atoms = await loadAtoms()
    const store = createStore()
    void store.set(atoms.rightPanelSizesAtom, [55, 45])
    void store.set(atoms.rightPanelCollapsedAtom, true)
    void store.set(atoms.rightPanelLastExpandedSizeAtom, 45)

    expect(localStorage.getItem('schaltwerk:layout:rightPanelSizes')).toBe(JSON.stringify([55, 45]))
    expect(localStorage.getItem('schaltwerk:layout:rightPanelCollapsed')).toBe('true')
    expect(localStorage.getItem('schaltwerk:layout:rightPanelLastExpandedSize')).toBe('45')
  })

  it('rehydrates from existing localStorage values on init', async () => {
    localStorage.setItem('schaltwerk:layout:leftPanelSizes', JSON.stringify([33, 67]))
    localStorage.setItem('schaltwerk:layout:rightPanelSizes', JSON.stringify([58, 42]))
    localStorage.setItem('schaltwerk:layout:leftPanelCollapsed', 'true')
    localStorage.setItem('schaltwerk:layout:rightPanelCollapsed', 'true')

    const atoms = await loadAtoms()
    const store = createStore()

    expect(store.get(atoms.leftPanelSizesAtom)).toEqual([33, 67])
    expect(store.get(atoms.rightPanelSizesAtom)).toEqual([58, 42])
    expect(store.get(atoms.leftPanelCollapsedAtom)).toBe(true)
    expect(store.get(atoms.rightPanelCollapsedAtom)).toBe(true)
  })
})
