import '@testing-library/jest-dom/vitest'
import { beforeEach, vi } from 'vitest'

// Setup global test environment
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// Mock window object for tests that need it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Ensure window is properly defined for React
if (!global.window) {
  global.window = window
}

// Global mocks for Tauri APIs used across components during tests
// Prevents happy-dom from calling into real Tauri internals (transformCallback)
vi.mock('@tauri-apps/api/event', () => {
  const listeners = new Map<string, Array<(evt: { event: string; payload?: unknown }) => void>>()
  return {
    listen: vi.fn(async (event: string, handler: (evt: { event: string; payload?: unknown }) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(handler)
      listeners.set(event, arr)
      // Return unlisten function
      return () => {
        const current = listeners.get(event) ?? []
        const idx = current.indexOf(handler)
        if (idx >= 0) current.splice(idx, 1)
        listeners.set(event, current)
      }
    }),
    // Optional helper for tests that want to emit events manually
    __emit: (event: string, payload?: unknown) => {
      const arr = listeners.get(event) ?? []
      for (const fn of arr) fn({ event, payload })
    }
  }
})

// Provide a safe default mock for invoke; individual tests can override as needed
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {
    throw new Error('no tauri')
  })
}))