import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
import { Terminal } from './Terminal'

const ATLAS_CONTRAST_BASE = 1
const ATLAS_CONTRAST_BUCKETS = 30

function computeAtlasContrastOffset(terminalId: string): number {
  let hash = 0
  for (let i = 0; i < terminalId.length; i += 1) {
    hash = (hash * 31 + terminalId.charCodeAt(i)) >>> 0
  }
  const bucket = (hash % ATLAS_CONTRAST_BUCKETS) + 1
  return bucket / 100
}

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

const terminalHarness = vi.hoisted(() => {
  const instances: any[] = []
  let nextIsNew = true

  const createMockRaw = () => {
    const disposable = () => ({ dispose: vi.fn() })
    return {
      options: { fontFamily: 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace' },
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          viewportY: 0,
          baseY: 0,
          length: 0,
        },
      },
      resize: vi.fn(function resize(this: any, cols: number, rows: number) {
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

  class MockXtermTerminal {
    static instances = instances
    raw: ReturnType<typeof createMockRaw>
    fitAddon: { fit: typeof vi.fn }
    searchAddon: { findNext: typeof vi.fn; findPrevious: typeof vi.fn }
    attach = vi.fn()
    detach = vi.fn()
    dispose = vi.fn()
    applyConfig = vi.fn((partial: Record<string, unknown>) => {
      this.config = { ...this.config, ...partial }
    })
    updateOptions = vi.fn((options: Record<string, unknown>) => {
      if ('fontSize' in options) {
        this.config.fontSize = options.fontSize as number
      }
      if ('fontFamily' in options) {
        this.config.fontFamily = options.fontFamily as string
      }
    })
    config: Record<string, unknown>
    constructor(public readonly options: any) {
      this.raw = createMockRaw()
      this.fitAddon = { fit: vi.fn() }
      this.searchAddon = { findNext: vi.fn(), findPrevious: vi.fn() }
      this.config = { ...(options?.config ?? {}) }
      instances.push(this)
    }
  }

  const acquireMock = vi.fn((id: string, factory: () => MockXtermTerminal) => {
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
  useCleanupRegistry: () => ({
    addCleanup: vi.fn(),
    addEventListener: vi.fn(),
    addResizeObserver: vi.fn(),
    addTimeout: vi.fn(),
    addInterval: vi.fn(),
  }),
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
    acquireTerminalInstance: vi.fn((id: string, factory: () => unknown) => acquireMock(id, factory as () => any)),
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
  // @ts-expect-error - assigning global constructors for test environment
  global.ResizeObserver = NoopObserver
  // @ts-expect-error - assigning global constructors for test environment
  global.IntersectionObserver = NoopObserver
  // @ts-expect-error - assigning global constructors for test environment
  global.MutationObserver = NoopObserver
  terminalHarness.instances.length = 0
  terminalHarness.acquireMock.mockClear()
  terminalHarness.setNextIsNew(true)
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

    const instance = terminalHarness.instances[0]
    const expectedContrast = ATLAS_CONTRAST_BASE + computeAtlasContrastOffset('session-123-bottom')
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(10000)
    expect(instance.config.fontSize).toBe(13)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(expectedContrast)
  })

  it('uses reduced scrollback for background terminals', async () => {
    render(<Terminal terminalId="background-1" isBackground />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0]
    const expectedContrast = ATLAS_CONTRAST_BASE + computeAtlasContrastOffset('background-1')
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(5000)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(expectedContrast)
  })

  it('applies deep scrollback for agent top terminals', async () => {
    render(<Terminal terminalId="session-example-top" sessionName="example" />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0]
    const expectedContrast = ATLAS_CONTRAST_BASE + computeAtlasContrastOffset('session-example-top')
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(20000)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(expectedContrast)
  })

  it('reapplies configuration when reusing an existing terminal instance', async () => {
    terminalHarness.setNextIsNew(false)
    render(<Terminal terminalId="session-123-bottom" readOnly />)

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0]
    expect(instance.applyConfig).toHaveBeenCalledWith(expect.objectContaining({
      readOnly: true,
    }))
  })
})
