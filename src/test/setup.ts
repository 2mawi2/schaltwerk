import '@testing-library/jest-dom/vitest'
import { randomUUID as nodeRandomUUID } from 'node:crypto'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Setup global test environment
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
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

// Ensure document is available globally for suites that reference global.document directly
if (typeof global.document === 'undefined' || global.document === null) {
  // happy-dom attaches document to window; reuse the same reference
  global.document = window.document
}

if (typeof window.dispatchEvent !== 'function') {
  const dispatch = EventTarget.prototype.dispatchEvent
  Object.defineProperty(window, 'dispatchEvent', {
    configurable: true,
    value: dispatch.bind(window),
  })
}

// Ensure timer APIs exist on window (happy-dom may only expose them on globalThis)
if (typeof window.setTimeout !== 'function') {
  window.setTimeout = global.setTimeout.bind(global)
}
if (typeof window.clearTimeout !== 'function') {
  window.clearTimeout = global.clearTimeout.bind(global)
}
if (typeof window.setInterval !== 'function') {
  window.setInterval = global.setInterval.bind(global)
}
if (typeof window.clearInterval !== 'function') {
  window.clearInterval = global.clearInterval.bind(global)
}

// Provide a default navigator.clipboard implementation so tests relying on clipboard APIs do not crash
try {
  if (!('clipboard' in navigator) || typeof navigator.clipboard === 'undefined') {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => ''),
      },
    })
  }
} catch {
  // Some navigator implementations have non-configurable clipboard; ignore in that case
}

// Polyfill crypto.randomUUID when unavailable (happy-dom < 12)
try {
  if (typeof crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: nodeRandomUUID,
      },
    })
  } else if (typeof crypto.randomUUID !== 'function') {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: nodeRandomUUID,
    })
  }
} catch {
  // Ignore environments that do not allow redefining crypto
}

// Global mocks for Tauri APIs used across components during tests
// Prevents happy-dom from calling into real Tauri internals (transformCallback)
vi.mock('@tauri-apps/api/event', () => {
  const listeners = new Map<string, Array<(evt: { event: string; payload?: unknown }) => void>>()
  const EVENT_NAME_SAFE_PATTERN = /[^a-zA-Z0-9/:_-]/g
  const normalizeEventName = (event: string) => {
    if (event.startsWith('terminal-output-')) {
      const prefix = 'terminal-output-'
      const name = event.slice(prefix.length).replace(EVENT_NAME_SAFE_PATTERN, '_')
      return `${prefix}${name}`
    }
    if (event.startsWith('terminal-output-normalized-')) {
      const prefix = 'terminal-output-normalized-'
      const name = event.slice(prefix.length).replace(EVENT_NAME_SAFE_PATTERN, '_')
      return `${prefix}${name}`
    }
    return event
  }
  return {
    listen: vi.fn(async (event: string, handler: (evt: { event: string; payload?: unknown }) => void) => {
      const normalized = normalizeEventName(event)
      const arr = listeners.get(normalized) ?? []
      arr.push(handler)
      listeners.set(normalized, arr)
      // Return unlisten function
      return () => {
        const current = listeners.get(normalized) ?? []
        const idx = current.indexOf(handler)
        if (idx >= 0) current.splice(idx, 1)
        listeners.set(normalized, current)
      }
    }),
    // Optional helper for tests that want to emit events manually
    __emit: (event: string, payload?: unknown) => {
      const normalized = normalizeEventName(event)
      const arr = listeners.get(normalized) ?? []
      for (const fn of arr) fn({ event: normalized, payload })
    }
  }
})

// Provide a safe default mock for invoke; individual tests can override as needed
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {
    throw new Error('no tauri')
  })
}))
