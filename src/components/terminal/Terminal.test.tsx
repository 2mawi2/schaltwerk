import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, cleanup, act, fireEvent } from '@testing-library/react'
import { Terminal } from './Terminal'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { startSessionTop } from '../../common/agentSpawn'
import { writeTerminalBackend } from '../../terminal/transport/backend'
import { TERMINAL_FILE_DRAG_TYPE } from '../../common/dragTypes'
import { UiEvent } from '../../common/uiEvents'
import { proposeDimensionsWithDpr } from './terminalSizing'

const ATLAS_CONTRAST_BASE = 1.1

const raf = vi.hoisted(() => vi.fn((cb: FrameRequestCallback) => {
  cb(performance.now())
  return 0
}))

const observerMocks = vi.hoisted(() => {
  class NoopObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  return {
    NoopObserver,
  }
})

const cleanupRegistryMock = vi.hoisted(() => ({
  addCleanup: vi.fn(),
  addEventListener: vi.fn(),
  addResizeObserver: vi.fn(),
  addTimeout: vi.fn(),
  addInterval: vi.fn(),
}))

const viewportControllerMocks = vi.hoisted(() => {
  const instances: Array<{
    options: { terminal?: unknown }
    api: {
      onResize: ReturnType<typeof vi.fn>
      onFocusOrClick: ReturnType<typeof vi.fn>
      onVisibilityChange: ReturnType<typeof vi.fn>
      dispose: ReturnType<typeof vi.fn>
    }
  }> = []

  const factory = vi.fn((options: { terminal: unknown }) => {
    const api = {
      onResize: vi.fn(() => {
        try {
          const raw = (options?.terminal as { raw?: HarnessInstance['raw'] } | undefined)?.raw
          const buf = raw?.buffer?.active
          if (buf) {
            const distance = buf.baseY - buf.viewportY
            if (distance < 5 && typeof raw?.scrollToBottom === 'function') {
              raw.scrollToBottom()
            }
          }
        } catch {
          // ignore test-time snap failures
        }
      }),
      onFocusOrClick: vi.fn(),
      onVisibilityChange: vi.fn(),
      dispose: vi.fn(),
    }
    instances.push({ options, api })
    return api
  })

  return { factory, instances }
})

type HarnessConfig = {
  scrollback: number
  fontSize: number
  fontFamily: string
  readOnly?: boolean
  minimumContrastRatio: number
  smoothScrolling?: boolean
  [key: string]: unknown
}

type HarnessInstance = {
  config: HarnessConfig
  applyConfig: ReturnType<typeof vi.fn>
  attach: ReturnType<typeof vi.fn>
  fitAddon: { fit: ReturnType<typeof vi.fn>; proposeDimensions?: () => { cols: number; rows: number } }
  searchAddon: { findNext: ReturnType<typeof vi.fn>; findPrevious: ReturnType<typeof vi.fn> }
  setFileLinkHandler: ReturnType<typeof vi.fn>
  setLinkHandler?: ReturnType<typeof vi.fn>
  raw: {
    cols: number
    rows: number
    buffer: {
      active: {
        viewportY: number
        baseY: number
        length: number
      }
    }
    resize: ReturnType<typeof vi.fn>
    scrollLines: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    hasSelection: ReturnType<typeof vi.fn>
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    onRender: ReturnType<typeof vi.fn>
    onScroll: ReturnType<typeof vi.fn>
    options: {
      scrollback?: number
      fontFamily?: string
      fontSize?: number
      disableStdin?: boolean
      minimumContrastRatio?: number
      [key: string]: unknown
    }
    parser: {
      registerOscHandler: ReturnType<typeof vi.fn>
    }
  }
}

const terminalHarness = vi.hoisted(() => {
  const instances: HarnessInstance[] = []
  let nextIsNew = true

  const createMockRaw = () => {
    const disposable = () => ({ dispose: vi.fn() })
    const raw = {
      options: { fontFamily: 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace', minimumContrastRatio: ATLAS_CONTRAST_BASE },
      cols: 80,
      rows: 24,
      _core: {
        _renderService: {
          dimensions: {
            actualCellWidth: 0,
            actualCellHeight: 0,
          },
        },
      },
      buffer: {
        active: {
          viewportY: 0,
          baseY: 0,
          length: 0,
        },
      },
      resize: vi.fn(function resize(this: { cols: number; rows: number }, cols: number, rows: number) {
        this.cols = cols
        this.rows = rows
      }),
      scrollLines: vi.fn(),
      scrollToBottom: vi.fn(),
      focus: vi.fn(),
      hasSelection: vi.fn(() => false),
      attachCustomKeyEventHandler: vi.fn(),
      parser: {
        registerOscHandler: vi.fn(() => true),
      },
      onData: vi.fn(() => disposable()),
      onRender: vi.fn((cb) => {
        // console.error('DEBUG: onRender called')
        if (typeof cb === 'function') cb()
        return disposable()
      }),
      onScroll: vi.fn(() => disposable()),
    }
    raw.scrollToBottom.mockImplementation(function(this: typeof raw) {
      this.buffer.active.viewportY = this.buffer.active.baseY
    })
    return raw
  }

  type RawTerminal = ReturnType<typeof createMockRaw>

  class MockXtermTerminal implements HarnessInstance {
    static instances = instances
    raw: RawTerminal
    fitAddon: HarnessInstance['fitAddon']
    searchAddon: HarnessInstance['searchAddon']
    attach = vi.fn()
    detach = vi.fn()
    dispose = vi.fn()
    setSmoothScrolling = vi.fn()
    refresh = vi.fn()
    applyConfig = vi.fn((partial: Record<string, unknown>) => {
      this.config = { ...this.config, ...partial } as HarnessConfig
    })
    updateOptions = vi.fn((options: Record<string, unknown>) => {
      if ('fontSize' in options) {
        this.config.fontSize = options.fontSize as number
      }
      if ('fontFamily' in options) {
        this.config.fontFamily = options.fontFamily as string
      }
    })
    setFileLinkHandler = vi.fn()
    setLinkHandler = vi.fn((handler: ((uri: string) => boolean | Promise<boolean>) | null) => {
      this.linkHandler = handler ?? null
    })
    linkHandler: ((uri: string) => boolean | Promise<boolean>) | null = null
    config: HarnessConfig
    constructor(public readonly options: { config?: Partial<HarnessConfig>; onLinkClick?: (uri: string) => boolean | Promise<boolean> } = {}) {
      this.raw = createMockRaw()
      this.fitAddon = { fit: vi.fn() }
      this.searchAddon = { findNext: vi.fn(), findPrevious: vi.fn() }
      this.config = { scrollback: 0, fontSize: 0, fontFamily: '', minimumContrastRatio: ATLAS_CONTRAST_BASE, ...(options?.config ?? {}) } as HarnessConfig
      if (options?.onLinkClick) {
        this.linkHandler = options.onLinkClick
      }
      instances.push(this)
    }
  }

  const acquireMock = vi.fn((id: string, factory: () => HarnessInstance) => {
    const xterm = factory()
    // console.error('DEBUG: acquireMock', { id, isNew: nextIsNew })
    const record = {
      id,
      xterm,
      refCount: 1,
      lastSeq: null,
      initialized: false,
      attached: true,
      streamRegistered: false,
    }
    const isNew = nextIsNew
    nextIsNew = true
    return {
      record,
      isNew,
    }
  })

  return {
    MockXtermTerminal,
    instances,
    acquireMock,
    setNextIsNew(value: boolean) {
      nextIsNew = value
    },
  }
})

vi.mock('../../hooks/useCleanupRegistry', () => ({
  useCleanupRegistry: () => cleanupRegistryMock,
}))

vi.mock('../../contexts/FontSizeContext', () => ({
  useFontSize: () => ({ terminalFontSize: 13 }),
}))

vi.mock('../../contexts/ModalContext', () => ({
  useModal: () => ({ isAnyModalOpen: false }),
}))

vi.mock('../../hooks/useTerminalGpu', () => ({
  useTerminalGpu: () => ({
    gpuRenderer: { current: null },
    gpuEnabledForTerminal: false,
    webglRendererActive: false,
    refreshGpuFontRendering: vi.fn(),
    applyLetterSpacing: vi.fn(),
    cancelGpuRefreshWork: vi.fn(),
    ensureRenderer: vi.fn(async () => {}),
    handleFontPreferenceChange: vi.fn(async () => {}),
  }),
}))

const registryMocks = vi.hoisted(() => ({
  hasTerminalInstance: vi.fn(() => false),
}))

vi.mock('../../terminal/registry/terminalRegistry', () => {
  const { acquireMock } = terminalHarness
  return {
    acquireTerminalInstance: vi.fn((id: string, factory: () => unknown) => acquireMock(id, factory as () => HarnessInstance)),
    releaseTerminalInstance: vi.fn(),
    removeTerminalInstance: vi.fn(),
    detachTerminalInstance: vi.fn(),
    hasTerminalInstance: registryMocks.hasTerminalInstance,
  }
})

vi.mock('../../terminal/xterm/XtermTerminal', () => {
  const { MockXtermTerminal } = terminalHarness
  return { XtermTerminal: MockXtermTerminal }
})

vi.mock('./viewport/TerminalViewportController', () => {
  const { factory } = viewportControllerMocks
  const Ctor = vi.fn(function TerminalViewportController(options: unknown) {
    return factory(options as { terminal: unknown })
  })
  return {
    TerminalViewportController: Ctor,
  }
})

vi.mock('../../terminal/stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    ensureStarted: vi.fn(async () => {}),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispose: vi.fn(async () => {}),
  },
}))

vi.mock('../../terminal/transport/backend', () => ({
  writeTerminalBackend: vi.fn(async () => {}),
  resizeTerminalBackend: vi.fn(async () => {}),
}))

vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn(async () => () => {}),
  SchaltEvent: {
    TerminalFocusRequested: 'TerminalFocusRequested',
    TerminalAgentStarted: 'TerminalAgentStarted',
    TerminalClosed: 'TerminalClosed',
    TerminalForceScroll: 'TerminalForceScroll',
  },
}))

vi.mock('../../common/uiEvents', () => ({
  UiEvent: { TerminalResizeRequest: 'TerminalResizeRequest', NewSpecRequest: 'NewSpecRequest', GlobalNewSessionShortcut: 'GlobalNewSessionShortcut', GlobalMarkReadyShortcut: 'GlobalMarkReadyShortcut' },
  emitUiEvent: vi.fn(),
  listenUiEvent: vi.fn(() => () => {}),
  clearBackgroundStarts: vi.fn(),
  hasBackgroundStart: vi.fn(() => false),
}))

vi.mock('../../common/agentSpawn', () => ({
  startOrchestratorTop: vi.fn(async () => {}),
  startSessionTop: vi.fn(async () => {}),
  AGENT_START_TIMEOUT_MESSAGE: 'timeout',
}))

const ptyResizeMock = vi.hoisted(() => ({
  schedulePtyResize: vi.fn(),
}))

vi.mock('../../common/ptyResizeScheduler', () => ptyResizeMock)

vi.mock('../../utils/singleflight', () => ({
  clearInflights: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../utils/safeFocus', () => ({
  safeTerminalFocus: vi.fn(),
  safeTerminalFocusImmediate: vi.fn((cb: () => void) => cb()),
}))

vi.mock('../../utils/terminalFonts', () => ({
  buildTerminalFontFamily: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({ fontFamily: null })),
}))

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  const id = setTimeout(() => {
    raf(cb)
  }, 16)
  return id
})

vi.stubGlobal('cancelAnimationFrame', (id: number) => {
  clearTimeout(id)
})

beforeEach(() => {
  cleanup()
  const { NoopObserver } = observerMocks
  const globalContext = globalThis as Record<string, unknown>
  globalContext.ResizeObserver = NoopObserver
  globalContext.IntersectionObserver = NoopObserver
  globalContext.MutationObserver = NoopObserver
  sessionStorage.clear()
  vi.mocked(listenEvent).mockReset()
  vi.mocked(listenEvent).mockImplementation(async () => () => {})
  terminalHarness.instances.length = 0
  terminalHarness.acquireMock.mockClear()
  terminalHarness.setNextIsNew(true)
  cleanupRegistryMock.addCleanup.mockClear()
  cleanupRegistryMock.addEventListener.mockClear()
  cleanupRegistryMock.addResizeObserver.mockClear()
  cleanupRegistryMock.addTimeout.mockClear()
  cleanupRegistryMock.addInterval.mockClear()
  viewportControllerMocks.factory.mockClear()
  viewportControllerMocks.instances.length = 0
  const navigatorAny = navigator as Navigator & { userAgent?: string }
  Object.defineProperty(navigatorAny, 'userAgent', {
    value: 'Macintosh',
    configurable: true,
  })
  vi.stubGlobal('getSelection', () => ({
    isCollapsed: true,
  }))
  registryMocks.hasTerminalInstance.mockReturnValue(false)
  vi.mocked(startSessionTop).mockClear()
})

describe('proposeDimensionsWithDpr', () => {
  it('scales measured dimensions by DPR and cell size', () => {
    const result = proposeDimensionsWithDpr({ width: 800, height: 600 }, 10, 20, 2)
    expect(result).toEqual({ cols: 160, rows: 60 })
  })

  it('returns undefined when cell metrics are missing', () => {
    expect(proposeDimensionsWithDpr({ width: 800, height: 600 }, Number.NaN, 20, 2)).toBeUndefined()
    expect(proposeDimensionsWithDpr({ width: 800, height: 600 }, 10, Number.NaN, 2)).toBeUndefined()
  })
})

describe('Terminal', () => {
  it('constructs XtermTerminal with default scrollback for regular terminals', async () => {
    render(<Terminal terminalId="session-123-bottom" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(10000)
    expect(instance.config.fontSize).toBe(13)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(ATLAS_CONTRAST_BASE)
  })

  it('uses reduced scrollback for background terminals', async () => {
    render(<Terminal terminalId="background-1" isBackground />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(5000)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(ATLAS_CONTRAST_BASE)
  })

  it('applies deep scrollback for agent top terminals', async () => {
    render(<Terminal terminalId="session-example-top" sessionName="example" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(20000)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(ATLAS_CONTRAST_BASE)
  })

  it('treats terminal-only top terminals as regular shells and skips agent startup', async () => {
    render(<Terminal terminalId="session-terminal-top" sessionName="terminal" agentType="terminal" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.config.scrollback).toBe(10000)

    await waitFor(() => {
      expect(startSessionTop).not.toHaveBeenCalled()
    })
  })

  it.skip('shows a restart banner when the initial agent start times out', async () => {
    vi.mocked(startSessionTop).mockRejectedValueOnce(new Error('timeout'))

    const { getByText } = render(
      <Terminal terminalId="session-timeout-top" sessionName="timeout" />
    )

    await waitFor(() => {
      expect(startSessionTop).toHaveBeenCalled()
    }, { timeout: 3000 })

    await waitFor(() => {
      expect(getByText(/Agent stopped/i)).toBeVisible()
    })
  })

  it('reapplies configuration when reusing an existing terminal instance', async () => {
    terminalHarness.setNextIsNew(false)
    registryMocks.hasTerminalInstance.mockReturnValue(true)
    render(<Terminal terminalId="session-123-bottom" readOnly />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).toHaveBeenCalledWith(expect.objectContaining({
      readOnly: true,
    }))
  })

  it('initializes the viewport controller when reusing an existing terminal instance', async () => {
    terminalHarness.setNextIsNew(false)
    registryMocks.hasTerminalInstance.mockReturnValue(true)

    render(<Terminal terminalId="session-reuse-viewport-top" sessionName="reuse-viewport" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(viewportControllerMocks.factory).toHaveBeenCalled()
    })

    const controllerRecord = viewportControllerMocks.instances[viewportControllerMocks.instances.length - 1]
    const instance = terminalHarness.instances[terminalHarness.instances.length - 1] as HarnessInstance

    expect(controllerRecord?.options?.terminal).toBe(instance)
  })

  it('ignores duplicate resize observer measurements', async () => {
    render(<Terminal terminalId="session-resize-case-top" sessionName="resize-case" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect(cleanupRegistryMock.addResizeObserver).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    instance.fitAddon.proposeDimensions = vi.fn(() => ({ cols: 132, rows: 48 }))
    instance.raw.cols = 132
    instance.raw.rows = 48

    vi.useFakeTimers()
    try {
      const calls = cleanupRegistryMock.addResizeObserver.mock.calls
      const lastCall = calls[calls.length - 1]
      const element = lastCall?.[0] as HTMLDivElement | undefined
      const resizeCallback = lastCall?.[1] as (() => void) | undefined
      expect(element).toBeDefined()
      expect(resizeCallback).toBeDefined()

      Object.defineProperty(element!, 'clientWidth', { configurable: true, value: 800 })
      Object.defineProperty(element!, 'clientHeight', { configurable: true, value: 600 })

      await act(async () => {
        resizeCallback?.()
        await vi.runOnlyPendingTimersAsync()
      })
      const baselineResizes = instance.raw.resize.mock.calls.length

      await act(async () => {
        resizeCallback?.()
        await vi.runOnlyPendingTimersAsync()
      })

      expect(instance.raw.resize.mock.calls.length).toBe(baselineResizes)
    } finally {
      vi.useRealTimers()
    }
  })

  it('forces a fit when devicePixelRatio changes', async () => {
    const originalMatchMedia = globalThis.matchMedia
    const originalDpr = globalThis.devicePixelRatio

    const matchMediaMock = vi.fn((query: string) => {
      return {
        media: query,
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      } as unknown as MediaQueryList
    })

    const originalAddEventListener = window.addEventListener
    const resizeHandlers: Array<(evt?: Event) => void> = []
    type AddEventListenerArgs = Parameters<typeof window.addEventListener>
    const addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((...args: AddEventListenerArgs) => {
        const [type, listener] = args
        if (type === 'resize' && typeof listener === 'function') {
          resizeHandlers.push(listener as (evt?: Event) => void)
        }
        return originalAddEventListener.apply(window, args)
      })

    vi.stubGlobal('matchMedia', matchMediaMock)
    // Ensure jsdom window sees the mock
    ;(window as unknown as { matchMedia: typeof matchMediaMock }).matchMedia = matchMediaMock
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true })

    render(<Terminal terminalId="session-dpr-top" sessionName="dpr" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    await waitFor(() => {
      expect(instance.attach).toHaveBeenCalled()
    })

    expect(matchMediaMock).toHaveBeenCalled()
    expect(resizeHandlers.length).toBeGreaterThan(0)

    const terminalContainer = document.querySelector('[data-smartdash-exempt="true"]') as HTMLDivElement | null
    const inner = terminalContainer?.firstElementChild as HTMLDivElement | null
    expect(inner).toBeTruthy()
    vi.spyOn(inner!, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(inner!, 'clientHeight', 'get').mockReturnValue(600)

    Object.defineProperty(globalThis, 'devicePixelRatio', { value: 2, configurable: true })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
      resizeHandlers.forEach(handler => handler(new Event('resize')))
    })

    // Restore globals
    addEventListenerSpy.mockRestore()
    if (originalMatchMedia) {
      vi.stubGlobal('matchMedia', originalMatchMedia)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).matchMedia = undefined
    }
    Object.defineProperty(globalThis, 'devicePixelRatio', { value: originalDpr ?? 1, configurable: true })
  })

  it('does not render the loading overlay when the terminal is already hydrated', async () => {
    registryMocks.hasTerminalInstance.mockReturnValue(true)
    terminalHarness.setNextIsNew(false)

    const { queryByLabelText } = render(
      <Terminal terminalId="session-prehydrated-top" sessionName="prehydrated" />
    )

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(queryByLabelText('Terminal loading')).toBeNull()
    })
  })

  it('scrolls to the bottom when a TerminalForceScroll event targets the terminal', async () => {
    const listeners = new Map<string, (payload: { terminal_id: string }) => void>()
    const originalImplementation = vi.mocked(listenEvent).getMockImplementation()
    vi.mocked(listenEvent).mockImplementation(async (event, handler) => {
      listeners.set(String(event), handler as (payload: { terminal_id: string }) => void)
      return () => {
        listeners.delete(String(event))
      }
    })

    try {
      render(<Terminal terminalId="session-force-scroll" sessionName="force-scroll" />)

      await waitFor(() => {
        expect(terminalHarness.acquireMock).toHaveBeenCalled()
        expect(terminalHarness.instances.length).toBeGreaterThan(0)
      })

      await waitFor(() => {
        expect(listeners.get(String(SchaltEvent.TerminalForceScroll))).toBeDefined()
      })

      const instance = terminalHarness.instances[terminalHarness.instances.length - 1] as HarnessInstance
      instance.raw.scrollToBottom.mockClear()

      const handler = listeners.get(String(SchaltEvent.TerminalForceScroll))
      expect(handler).toBeDefined()

      await act(async () => {
        handler?.({ terminal_id: 'session-force-scroll' })
      })

      await waitFor(() => {
        expect(instance.raw.scrollToBottom).toHaveBeenCalled()
      })
    } finally {
      vi.mocked(listenEvent).mockImplementation(originalImplementation ?? (async () => () => {}))
    }
  })

  it('ignores TerminalForceScroll events for other terminals', async () => {
    const listeners = new Map<string, (payload: { terminal_id: string }) => void>()
    const originalImplementation = vi.mocked(listenEvent).getMockImplementation()
    vi.mocked(listenEvent).mockImplementation(async (event, handler) => {
      listeners.set(String(event), handler as (payload: { terminal_id: string }) => void)
      return () => {
        listeners.delete(String(event))
      }
    })

    try {
      render(<Terminal terminalId="session-force-ignore" sessionName="force-ignore" />)

      await waitFor(() => {
        expect(terminalHarness.acquireMock).toHaveBeenCalled()
        expect(terminalHarness.instances.length).toBeGreaterThan(0)
      })

      await waitFor(() => {
        expect(listeners.get(String(SchaltEvent.TerminalForceScroll))).toBeDefined()
      })

      const instance = terminalHarness.instances[terminalHarness.instances.length - 1] as HarnessInstance
      instance.raw.scrollToBottom.mockClear()

      const handler = listeners.get(String(SchaltEvent.TerminalForceScroll))
      expect(handler).toBeDefined()

      await act(async () => {
        handler?.({ terminal_id: 'other-terminal' })
      })

      await waitFor(() => {
        expect(instance.raw.scrollToBottom).not.toHaveBeenCalled()
      })
    } finally {
      vi.mocked(listenEvent).mockImplementation(originalImplementation ?? (async () => () => {}))
    }
  })

  it('pastes dropped file paths into the terminal input', async () => {
    const { container } = render(<Terminal terminalId="session-drop-bottom" workingDirectory="/repo" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
    })

    const terminalContainer = container.querySelector('[data-smartdash-exempt="true"]') as HTMLDivElement | null
    expect(terminalContainer).toBeTruthy()

    const payload = { filePath: 'src/example.ts' }
    const dataTransfer = {
      types: [TERMINAL_FILE_DRAG_TYPE],
      getData: vi.fn((type: string) => type === TERMINAL_FILE_DRAG_TYPE ? JSON.stringify(payload) : ''),
      dropEffect: 'none',
      effectAllowed: '',
    }

    fireEvent.dragOver(terminalContainer as Element, { dataTransfer })
    fireEvent.drop(terminalContainer as Element, { dataTransfer })

    await waitFor(() => {
      expect(writeTerminalBackend).toHaveBeenCalledWith('session-drop-bottom', './src/example.ts ')
    })
  })
})
