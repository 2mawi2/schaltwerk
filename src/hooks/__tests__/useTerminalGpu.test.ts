import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { MutableRefObject } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const {
  MockWebGLTerminalRenderer,
  setRendererStateType,
  resetRendererStateType,
  getLastRenderer,
  clearLastRenderer,
} = vi.hoisted(() => {
  let rendererStateType: 'canvas' | 'webgl' = 'canvas'
  let lastRenderer: unknown = null

  class MockWebGLTerminalRenderer {
    #state: { type: 'canvas' | 'webgl' | 'none'; contextLost: boolean } = {
      type: 'canvas',
      contextLost: false,
    }
    constructor() {
      lastRenderer = this
    }
    ensureLoaded = vi.fn(async () => {
      if (rendererStateType === 'webgl') {
        this.#state = { type: 'webgl', contextLost: false }
      } else if (rendererStateType === 'canvas') {
        this.#state = { type: 'canvas', contextLost: false }
      }
      return this.#state
    })
    getState = vi.fn(() => this.#state)
    setCallbacks = vi.fn()
    clearTextureAtlas = vi.fn()
    disposeIfLoaded = vi.fn(() => {
      if (this.#state.type === 'webgl') {
        this.#state = { type: 'none', contextLost: false }
      }
    })
    resetAttempt = vi.fn()
    dispose = vi.fn(() => {
      this.#state = { type: 'none', contextLost: false }
    })
  }

  return {
    MockWebGLTerminalRenderer,
    setRendererStateType: (type: 'canvas' | 'webgl') => {
      rendererStateType = type
    },
    resetRendererStateType: () => {
      rendererStateType = 'canvas'
    },
    getLastRenderer: () => lastRenderer as MockWebGLTerminalRenderer | null,
    clearLastRenderer: () => {
      lastRenderer = null
    },
  }
})

vi.mock('../../terminal/gpu/webglRenderer', () => ({
  WebGLTerminalRenderer: MockWebGLTerminalRenderer,
}))

const {
  rendererStore,
  getGpuRendererMock,
  setGpuRendererMock,
  disposeGpuRendererMock,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  return {
    rendererStore: store,
    getGpuRendererMock: vi.fn((id: string) => store.get(id) ?? null),
    setGpuRendererMock: vi.fn((id: string, renderer: unknown) => {
      store.set(id, renderer)
    }),
    disposeGpuRendererMock: vi.fn((id: string) => {
      store.delete(id)
    }),
  }
})

vi.mock('../../terminal/gpu/gpuRendererRegistry', () => ({
  getGpuRenderer: getGpuRendererMock,
  setGpuRenderer: setGpuRendererMock,
  disposeGpuRenderer: disposeGpuRendererMock,
}))

const { shouldAttemptWebglMock } = vi.hoisted(() => ({
  shouldAttemptWebglMock: vi.fn(() => false),
}))

vi.mock('../../terminal/gpu/gpuFallbackState', () => ({
  shouldAttemptWebgl: () => shouldAttemptWebglMock(),
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
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ webglEnabled: true })

    resetRendererStateType()
    clearLastRenderer()
    rendererStore.clear()
    getGpuRendererMock.mockClear()
    setGpuRendererMock.mockClear()
    disposeGpuRendererMock.mockClear()
    shouldAttemptWebglMock.mockReset()
    shouldAttemptWebglMock.mockReturnValue(false)

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

  it('reinitializes the GPU renderer when font preferences change', async () => {
    shouldAttemptWebglMock.mockReturnValue(true)
    setRendererStateType('webgl')

    const { result } = renderHook(() =>
      useTerminalGpu({
        terminalId: 'gpu-terminal',
        terminalRef,
        fitAddonRef,
        isBackground: false,
        applySizeUpdate: vi.fn(() => true),
      })
    )

    await act(async () => {
      await result.current.ensureRenderer()
    })

    const renderer = getLastRenderer()
    expect(renderer).not.toBeNull()
    if (!renderer) throw new Error('renderer not created')

    renderer.disposeIfLoaded.mockClear()
    renderer.resetAttempt.mockClear()
    renderer.ensureLoaded.mockClear()

    setRendererStateType('webgl')

    await act(async () => {
      await result.current.handleFontPreferenceChange()
    })

    expect(renderer.disposeIfLoaded).toHaveBeenCalledTimes(1)
    expect(renderer.resetAttempt).toHaveBeenCalledTimes(1)
    expect(renderer.ensureLoaded).toHaveBeenCalled()
  })

  it('ignores font preference changes when GPU rendering is disabled', async () => {
    shouldAttemptWebglMock.mockReturnValue(false)
    const { result } = renderHook(() =>
      useTerminalGpu({
        terminalId: 'dom-terminal',
        terminalRef,
        fitAddonRef,
        isBackground: true,
        applySizeUpdate: vi.fn(() => true),
      })
    )

    setGpuRendererMock.mockClear()
    disposeGpuRendererMock.mockClear()

    await act(async () => {
      await result.current.handleFontPreferenceChange()
    })

    expect(setGpuRendererMock).not.toHaveBeenCalled()
    expect(disposeGpuRendererMock).not.toHaveBeenCalled()
    expect(rendererStore.size).toBe(0)
  })

  it('does not clear the WebGL texture atlas when reusing the renderer', async () => {
    shouldAttemptWebglMock.mockReturnValue(true)
    setRendererStateType('webgl')

    const { result } = renderHook(() =>
      useTerminalGpu({
        terminalId: 'reuse-terminal',
        terminalRef,
        fitAddonRef,
        isBackground: false,
        applySizeUpdate: vi.fn(() => true),
      })
    )

    await act(async () => {
      await result.current.ensureRenderer()
    })

    const renderer = getLastRenderer()
    expect(renderer).not.toBeNull()
    if (!renderer) throw new Error('renderer not created')

    renderer.clearTextureAtlas.mockClear()

    await act(async () => {
      await result.current.ensureRenderer()
    })

    expect(renderer.clearTextureAtlas).not.toHaveBeenCalled()
  })
})
