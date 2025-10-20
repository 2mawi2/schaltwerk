import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { Terminal } from './Terminal'

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

type HarnessConfig = {
  scrollback: number
  fontSize: number
  fontFamily: string
  readOnly?: boolean
  minimumContrastRatio: number
  [key: string]: unknown
}

type HarnessInstance = {
  config: HarnessConfig
  applyConfig: ReturnType<typeof vi.fn>
  fitAddon: { fit: ReturnType<typeof vi.fn>; proposeDimensions?: () => { cols: number; rows: number } }
  searchAddon: { findNext: ReturnType<typeof vi.fn>; findPrevious: ReturnType<typeof vi.fn> }
  raw: {
    cols: number
    rows: number
    resize: ReturnType<typeof vi.fn>
    options: {
      scrollback?: number
      fontFamily?: string
      fontSize?: number
      disableStdin?: boolean
      minimumContrastRatio?: number
      [key: string]: unknown
    }
  }
}

const terminalHarness = vi.hoisted(() => {
  const instances: HarnessInstance[] = []
  let nextIsNew = true

  const createMockRaw = () => {
    const disposable = () => ({ dispose: vi.fn() })
    return {
      options: { fontFamily: 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace', minimumContrastRatio: ATLAS_CONTRAST_BASE },
      cols: 80,
      rows: 24,
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
      onRender: vi.fn(() => disposable()),
    }
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
    config: HarnessConfig
    constructor(public readonly options: { config?: Partial<HarnessConfig> } = {}) {
      this.raw = createMockRaw()
      this.fitAddon = { fit: vi.fn() }
      this.searchAddon = { findNext: vi.fn(), findPrevious: vi.fn() }
      this.config = { scrollback: 0, fontSize: 0, fontFamily: '', minimumContrastRatio: ATLAS_CONTRAST_BASE, ...(options?.config ?? {}) } as HarnessConfig
      instances.push(this)
    }
  }

  const acquireMock = vi.fn((id: string, factory: () => HarnessInstance) => {
    const xterm = factory()
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
    refreshGpuFontRendering: vi.fn(),
    applyLetterSpacing: vi.fn(),
    cancelGpuRefreshWork: vi.fn(),
    ensureRenderer: vi.fn(async () => {}),
  }),
}))

vi.mock('../../terminal/registry/terminalRegistry', () => {
  const { acquireMock } = terminalHarness
  return {
    acquireTerminalInstance: vi.fn((id: string, factory: () => unknown) => acquireMock(id, factory as () => HarnessInstance)),
    releaseTerminalInstance: vi.fn(),
    detachTerminalInstance: vi.fn(),
  }
})

vi.mock('../../terminal/xterm/XtermTerminal', () => {
  const { MockXtermTerminal } = terminalHarness
  return { XtermTerminal: MockXtermTerminal }
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
  SchaltEvent: { TerminalFocusRequested: 'TerminalFocusRequested' },
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
  }, 0)
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
  terminalHarness.instances.length = 0
  terminalHarness.acquireMock.mockClear()
  terminalHarness.setNextIsNew(true)
  cleanupRegistryMock.addCleanup.mockClear()
  cleanupRegistryMock.addEventListener.mockClear()
  cleanupRegistryMock.addResizeObserver.mockClear()
  cleanupRegistryMock.addTimeout.mockClear()
  cleanupRegistryMock.addInterval.mockClear()
  const navigatorAny = navigator as Navigator & { userAgent?: string }
  Object.defineProperty(navigatorAny, 'userAgent', {
    value: 'Macintosh',
    configurable: true,
  })
  vi.stubGlobal('getSelection', () => ({
    isCollapsed: true,
  }))
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

  it('reapplies configuration when reusing an existing terminal instance', async () => {
    terminalHarness.setNextIsNew(false)
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

      resizeCallback?.()
      await vi.runOnlyPendingTimersAsync()
      const baselineResizes = instance.raw.resize.mock.calls.length

      resizeCallback?.()
      await vi.runOnlyPendingTimersAsync()

      expect(instance.raw.resize.mock.calls.length).toBe(baselineResizes)
    } finally {
      vi.useRealTimers()
    }
  })
})
