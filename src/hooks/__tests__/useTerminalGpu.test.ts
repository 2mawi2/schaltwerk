import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MutableRefObject } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../terminal/gpu/webglRenderer', () => ({
  WebGLTerminalRenderer: class {
    #state = { type: 'canvas' as const }
    constructor() {}
    ensureLoaded() {
      return Promise.resolve(this.#state)
    }
    getState() {
      return this.#state
    }
    setCallbacks() {}
    clearTextureAtlas() {}
  },
}))

vi.mock('../../terminal/gpu/gpuRendererRegistry', () => ({
  getGpuRenderer: vi.fn(() => null),
  setGpuRenderer: vi.fn(),
  disposeGpuRenderer: vi.fn(),
}))

vi.mock('../../terminal/gpu/gpuFallbackState', () => ({
  shouldAttemptWebgl: () => false,
  resetSuggestedRendererType: vi.fn(),
  markWebglFailedGlobally: vi.fn(),
}))

vi.mock('../../utils/terminalLetterSpacing', () => ({
  applyTerminalLetterSpacing: undefined,
  DEFAULT_LETTER_SPACING: 0,
  GPU_LETTER_SPACING: 0.6,
}))

import { useTerminalGpu } from '../useTerminalGpu'

describe('useTerminalGpu', () => {
  let terminalRef: MutableRefObject<XTerm | null>
  let fitAddonRef: MutableRefObject<FitAddon | null>

  beforeEach(() => {
    terminalRef = { current: {
      options: { letterSpacing: 0 },
      rows: 24,
      refresh: vi.fn(),
      scrollToBottom: vi.fn(),
      hasSelection: vi.fn(() => false),
    } as unknown as XTerm }
    fitAddonRef = { current: null }
  })

  it('does not throw if terminal letter spacing helper is unavailable', () => {
    const { result } = renderHook(() =>
      useTerminalGpu({
        terminalId: 'test-terminal',
        terminalRef,
        fitAddonRef,
        isBackground: false,
        applySizeUpdate: vi.fn(() => true),
      })
    )

    expect(() => {
      result.current.applyLetterSpacing(true)
    }).not.toThrow()
  })
})
