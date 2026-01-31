import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, cleanup, act, fireEvent, type RenderOptions } from '@testing-library/react'
import { Terminal, type TerminalProps } from './Terminal'
import { listenEvent } from '../../common/eventSystem'
import { startSessionTop } from '../../common/agentSpawn'
import { writeTerminalBackend } from '../../terminal/transport/backend'
import { TERMINAL_FILE_DRAG_TYPE } from '../../common/dragTypes'
import { __resetTerminalTargetingForTest, getActiveAgentTerminalId, setActiveAgentTerminalId } from '../../common/terminalTargeting'
import { Provider, createStore } from 'jotai'
import { agentTabsStateAtom, type AgentTab } from '../../store/atoms/agentTabs'
import { useAgentTabs } from '../../hooks/useAgentTabs'
import type { AgentType } from '../../types/session'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'

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

const gpuMockState = vi.hoisted(() => ({
  enabled: true,
  setEnabled(value: boolean) {
    this.enabled = value
  },
}))

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
    scrollToLine: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    selectAll: ReturnType<typeof vi.fn>
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
      scrollToLine: vi.fn(function scrollToLine(this: typeof raw, line: number) {
        const baseY = this.buffer.active.baseY
        this.buffer.active.viewportY = Math.max(0, Math.min(baseY, line))
      }),
      scrollToBottom: vi.fn(),
      selectAll: vi.fn(),
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
    setMouseTrackingAllowed = vi.fn()
    uiMode: 'standard' | 'tui' = 'standard'
    isTuiMode = vi.fn(() => this.uiMode === 'tui')
    shouldFollowOutput = vi.fn(() => this.uiMode !== 'tui')
    setUiMode = vi.fn((mode: 'standard' | 'tui') => {
      this.uiMode = mode
    })
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
    constructor(
      public readonly options: {
        config?: Partial<HarnessConfig>;
        onLinkClick?: (uri: string) => boolean | Promise<boolean>;
        uiMode?: 'standard' | 'tui';
        [key: string]: unknown;
      } = {},
    ) {
      this.raw = createMockRaw()
      this.fitAddon = { fit: vi.fn() }
      this.searchAddon = { findNext: vi.fn(), findPrevious: vi.fn() }
      this.config = { scrollback: 0, fontSize: 0, fontFamily: '', minimumContrastRatio: ATLAS_CONTRAST_BASE, ...(options?.config ?? {}) } as HarnessConfig
      this.uiMode = options.uiMode ?? 'standard'
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
    gpuEnabledForTerminal: gpuMockState.enabled,
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
    attachTerminalInstance: vi.fn((_id: string, container: HTMLElement) => {
      const textarea = document.createElement('textarea')
      textarea.classList.add('xterm-helper-textarea')
      container.appendChild(textarea)
    }),
    releaseTerminalInstance: vi.fn(),
    removeTerminalInstance: vi.fn(),
    detachTerminalInstance: vi.fn(),
    hasTerminalInstance: registryMocks.hasTerminalInstance,
    addTerminalOutputCallback: vi.fn(),
    removeTerminalOutputCallback: vi.fn(),
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
  SchaltEvent: {
    TerminalFocusRequested: 'TerminalFocusRequested',
    TerminalAgentStarted: 'TerminalAgentStarted',
    TerminalClosed: 'TerminalClosed',
  },
}))

vi.mock('../../common/uiEvents', () => ({
  UiEvent: { TerminalResizeRequest: 'TerminalResizeRequest', NewSpecRequest: 'NewSpecRequest', GlobalNewSessionShortcut: 'GlobalNewSessionShortcut', GlobalMarkReadyShortcut: 'GlobalMarkReadyShortcut' },
  emitUiEvent: vi.fn(),
  listenUiEvent: vi.fn(() => () => {}),
}))

vi.mock('../../common/terminalStartState', () => ({
  isTerminalStartingOrStarted: vi.fn(() => false),
  markTerminalStarted: vi.fn(),
  clearTerminalStartState: vi.fn(),
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
  buildTerminalFontFamily: vi.fn((custom?: string | null) => {
    const base = 'Menlo, Monaco, ui-monospace, SFMono-Regular, monospace'
    return custom ? `"${custom}", ${base}` : base
  }),
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
  gpuMockState.setEnabled(true)
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
  vi.mocked(writeTerminalBackend).mockClear()
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockImplementation(async () => ({ fontFamily: null }))
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
  __resetTerminalTargetingForTest()
})

function renderTerminal(props: Partial<TerminalProps> & { terminalId: string }, options?: RenderOptions) {
  const store = createStore()
  return render(
    <Provider store={store}>
      <Terminal {...props} />
    </Provider>,
    options
  )
}

function createWheelEvent(deltaY: number) {
  if (typeof WheelEvent !== 'undefined') {
    return new WheelEvent('wheel', { deltaY, deltaMode: 0, cancelable: true })
  }
  const event = new Event('wheel', { cancelable: true }) as WheelEvent
  Object.defineProperty(event, 'deltaY', { value: deltaY })
  Object.defineProperty(event, 'deltaMode', { value: 0 })
  return event
}

describe('Terminal', () => {
  it('does not reinitialize the terminal when GPU preference changes', async () => {
    gpuMockState.setEnabled(true)
    const store = createStore()
    const utils = render(
      <Provider store={store}>
        <Terminal terminalId="session-gpu-toggle-top" sessionName="gpu-toggle" />
      </Provider>,
    )

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalledTimes(1)
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    gpuMockState.setEnabled(false)
    utils.rerender(
      <Provider store={store}>
        <Terminal terminalId="session-gpu-toggle-top" sessionName="gpu-toggle" />
      </Provider>,
    )

    // If the init effect re-runs, it will detach/cleanup and acquire again.
    expect(terminalHarness.acquireMock).toHaveBeenCalledTimes(1)
  })

  it('scrolls the buffer and prevents default for opencode wheel events', async () => {
    const { container } = renderTerminal({
      terminalId: 'orchestrator-opencode-top',
      agentType: 'opencode',
      isCommander: true,
    })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const termNode = container.querySelector('[data-terminal-id="orchestrator-opencode-top"]')
    expect(termNode).not.toBeNull()

    const instance = terminalHarness.instances[0]
    // Set baseY > 0 so scrollLines path is taken (otherwise PageUp/PageDown sequences are sent)
    instance.raw.buffer.active.baseY = 100

    const wheelEvent = createWheelEvent(120)

    act(() => {
      termNode?.dispatchEvent(wheelEvent)
    })

    expect(instance.raw.scrollLines).toHaveBeenCalled()
    expect(wheelEvent.defaultPrevented).toBe(true)
  })

  it('does not intercept wheel events for non-opencode agents', async () => {
    const { container } = renderTerminal({
      terminalId: 'session-codex-top',
      agentType: 'codex',
      sessionName: 'codex-session',
    })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const termNode = container.querySelector('[data-terminal-id="session-codex-top"]')
    expect(termNode).not.toBeNull()

    const wheelEvent = createWheelEvent(120)

    act(() => {
      termNode?.dispatchEvent(wheelEvent)
    })

    const instance = terminalHarness.instances[0]
    expect(instance.raw.scrollLines).not.toHaveBeenCalled()
    expect(wheelEvent.defaultPrevented).toBe(false)
  })

  it('constructs XtermTerminal with default scrollback for regular terminals', async () => {
    renderTerminal({ terminalId: 'session-123-bottom' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).not.toHaveBeenCalled()
    expect(instance.config.scrollback).toBe(20000)
    expect(instance.config.fontSize).toBe(13)
    expect(instance.config.fontFamily).toBe('Menlo, Monaco, ui-monospace, SFMono-Regular, monospace')
    expect(instance.config.minimumContrastRatio).toBeCloseTo(ATLAS_CONTRAST_BASE)
  })

  it('selects all terminal output on Cmd+A (macOS)', async () => {
    renderTerminal({ terminalId: 'session-select-all-top', sessionName: 'select-all' })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect((terminalHarness.instances[0] as HarnessInstance).raw.attachCustomKeyEventHandler).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const handler = instance.raw.attachCustomKeyEventHandler.mock.calls[0]?.[0] as ((event: KeyboardEvent) => boolean)
    expect(typeof handler).toBe('function')

    const event = {
      type: 'keydown',
      key: 'a',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    const result = handler(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(instance.raw.selectAll).toHaveBeenCalled()
    expect(result).toBe(false)
  })

  it('routes Option+Arrow navigation to word-move sequences on macOS', async () => {
    renderTerminal({ terminalId: 'session-alt-arrow-top', sessionName: 'alt-arrow' })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect((terminalHarness.instances[0] as HarnessInstance).raw.attachCustomKeyEventHandler).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const handler = instance.raw.attachCustomKeyEventHandler.mock.calls[0]?.[0] as ((event: KeyboardEvent) => boolean)

    const event = {
      type: 'keydown',
      key: 'ArrowLeft',
      metaKey: false,
      ctrlKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    vi.mocked(writeTerminalBackend).mockClear()
    const result = handler(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(writeTerminalBackend).toHaveBeenCalledWith('session-alt-arrow-top', '\x1bb')
    expect(result).toBe(false)
  })

  it('selects all terminal output on Cmd+A via window capture handler', async () => {
    const utils = renderTerminal({ terminalId: 'session-select-all-capture-top', sessionName: 'select-all-capture' })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    instance.raw.selectAll.mockClear()

    const textarea = utils.container.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    textarea!.focus()

    const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })
    textarea!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(instance.raw.selectAll).toHaveBeenCalledTimes(1)
  })

  it('does not steal focus after drag-selection for non-run terminals', async () => {
    const onTerminalClick = vi.fn()
    const utils = renderTerminal({ terminalId: 'session-drag-select-top', sessionName: 'drag-select', agentType: 'claude', onTerminalClick })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    instance.raw.focus.mockClear()
    onTerminalClick.mockClear()

    const container = utils.container.querySelector('[data-smartdash-exempt="true"]') as HTMLDivElement | null
    expect(container).not.toBeNull()

    fireEvent.mouseDown(container!, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(container!, { clientX: 30, clientY: 10 })
    fireEvent.mouseUp(container!)
    fireEvent.click(container!)

    expect(instance.raw.focus).not.toHaveBeenCalled()
    expect(onTerminalClick).not.toHaveBeenCalled()
  })

  it('applies deep scrollback for agent top terminals', async () => {
    renderTerminal({ terminalId: 'session-example-top', sessionName: 'example' })

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

  it('uses agent scrollback for TUI-based agents (kilocode)', async () => {
    renderTerminal({ terminalId: 'session-kilocode-top', sessionName: 'kilocode', agentType: 'kilocode' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.config.scrollback).toBe(20000)
  })

  it('uses agent scrollback for TUI-based agents (claude)', async () => {
    renderTerminal({ terminalId: 'session-claude-top', sessionName: 'claude', agentType: 'claude' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.config.scrollback).toBe(20000)
  })

  it('treats terminal-only top terminals as regular shells and skips agent startup', async () => {
    renderTerminal({ terminalId: 'session-terminal-top', sessionName: 'terminal', agentType: 'terminal' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.config.scrollback).toBe(20000)

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
    renderTerminal({ terminalId: 'session-123-bottom', readOnly: true })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.applyConfig).toHaveBeenCalledWith(expect.objectContaining({
      readOnly: true,
    }))
  })

  it('registers an onData handler even when readOnly is true', async () => {
    renderTerminal({ terminalId: 'session-readonly-bottom', readOnly: true })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    expect(instance.raw.onData).toHaveBeenCalled()
  })

  it('only forwards input for the active agent tab terminal', async () => {
    setActiveAgentTerminalId('demo', 'session-demo-top')

    const createdById = new Map<string, HarnessInstance>()
    type AcquireResult = ReturnType<typeof terminalHarness.acquireMock>
    const originalAcquire = terminalHarness.acquireMock.getMockImplementation() as (
      (id: string, factory: () => HarnessInstance) => AcquireResult
    )

    terminalHarness.acquireMock.mockImplementation((id: string, factory: () => HarnessInstance): AcquireResult => {
      let created: HarnessInstance | undefined
      const result = originalAcquire(id, () => {
        const instance = factory()
        created = instance
        return instance
      })
      if (created) {
        createdById.set(id, created)
      }
      return result
    })

    const store = createStore()
    try {
      render(
        <Provider store={store}>
          <Terminal terminalId="session-demo-top" sessionName="demo" />
          <Terminal terminalId="session-demo-top-1" sessionName="demo" />
        </Provider>
      )

      await waitFor(() => {
        expect(createdById.has('session-demo-top')).toBe(true)
        expect(createdById.has('session-demo-top-1')).toBe(true)
      })

      const primary = createdById.get('session-demo-top')!
      const secondary = createdById.get('session-demo-top-1')!
      const primaryOnData = primary.raw.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined
      const secondaryOnData = secondary.raw.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined

      expect(primaryOnData).toBeTypeOf('function')
      expect(secondaryOnData).toBeTypeOf('function')

      // Ignore initialization writes (e.g. empty init payload) triggered by mount/RAF.
      vi.mocked(writeTerminalBackend).mockClear()
      primaryOnData?.('\u001b')
      secondaryOnData?.('\u001b')

      expect(writeTerminalBackend).toHaveBeenCalledTimes(1)
      expect(writeTerminalBackend).toHaveBeenCalledWith('session-demo-top', '\u001b')
    } finally {
      terminalHarness.acquireMock.mockReset()
      if (originalAcquire) {
        terminalHarness.acquireMock.mockImplementation(originalAcquire)
      }
    }
  })

  it('initializes agent tab input targeting from agent tabs state (no manual targeting setup)', async () => {
    const sessionId = 'demo'
    const baseTerminalId = 'session-demo-top'

    function AgentTabsHarness() {
      useAgentTabs(sessionId, baseTerminalId)
      return null
    }

    const createdById = new Map<string, HarnessInstance>()
    type AcquireResult = ReturnType<typeof terminalHarness.acquireMock>
    const originalAcquire = terminalHarness.acquireMock.getMockImplementation() as (
      (id: string, factory: () => HarnessInstance) => AcquireResult
    )

    terminalHarness.acquireMock.mockImplementation((id: string, factory: () => HarnessInstance): AcquireResult => {
      let created: HarnessInstance | undefined
      const result = originalAcquire(id, () => {
        const instance = factory()
        created = instance
        return instance
      })
      if (created) {
        createdById.set(id, created)
      }
      return result
    })

    const store = createStore()
    const tabs: AgentTab[] = [
      { id: 'tab-0', terminalId: baseTerminalId, label: 'Agent 1', agentType: 'claude' },
      { id: 'tab-1', terminalId: `${baseTerminalId}-1`, label: 'Agent 2', agentType: 'codex' as AgentType },
    ]
    store.set(agentTabsStateAtom, new Map([[sessionId, { tabs, activeTab: 1 }]]))

    try {
      render(
        <Provider store={store}>
          <AgentTabsHarness />
          <Terminal terminalId={baseTerminalId} sessionName={sessionId} />
          <Terminal terminalId={`${baseTerminalId}-1`} sessionName={sessionId} />
        </Provider>
      )

      await waitFor(() => {
        expect(createdById.has(baseTerminalId)).toBe(true)
        expect(createdById.has(`${baseTerminalId}-1`)).toBe(true)
      })

      await waitFor(() => {
        expect(getActiveAgentTerminalId(sessionId)).toBe(`${baseTerminalId}-1`)
      })

      const primary = createdById.get(baseTerminalId)!
      const secondary = createdById.get(`${baseTerminalId}-1`)!
      const primaryOnData = primary.raw.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined
      const secondaryOnData = secondary.raw.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined

      expect(primaryOnData).toBeTypeOf('function')
      expect(secondaryOnData).toBeTypeOf('function')

      vi.mocked(writeTerminalBackend).mockClear()
      primaryOnData?.('\u001b')
      secondaryOnData?.('\u001b')

      const firstWrites = vi.mocked(writeTerminalBackend).mock.calls.filter((call) => call[1] === '\u001b')
      expect(firstWrites).toHaveLength(1)
      expect(firstWrites[0]).toEqual([`${baseTerminalId}-1`, '\u001b'])

      vi.mocked(writeTerminalBackend).mockClear()

      await act(async () => {
        store.set(agentTabsStateAtom, new Map([[sessionId, { tabs, activeTab: 0 }]]))
      })
      expect(getActiveAgentTerminalId(sessionId)).toBe(baseTerminalId)

      primaryOnData?.('\u001b')
      secondaryOnData?.('\u001b')

      const secondWrites = vi.mocked(writeTerminalBackend).mock.calls.filter((call) => call[1] === '\u001b')
      expect(secondWrites).toHaveLength(1)
      expect(secondWrites[0]).toEqual([baseTerminalId, '\u001b'])
    } finally {
      terminalHarness.acquireMock.mockReset()
      if (originalAcquire) {
        terminalHarness.acquireMock.mockImplementation(originalAcquire)
      }
    }
  })

  it('drops mouse tracking sequences before sending to the backend', async () => {
    const { instances } = terminalHarness

    renderTerminal({ terminalId: 'session-mouse-top', sessionName: 'demo' })

    await waitFor(() => {
      expect(instances.length).toBeGreaterThan(0)
    })

    const instance = instances[0] as HarnessInstance
    const onData = instance.raw.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined
    expect(onData).toBeTypeOf('function')

    vi.mocked(writeTerminalBackend).mockClear()

    onData?.('\u001b[<1;2;3M')
    onData?.('\u001b[<1;2;3m')
    onData?.('\u001b[M!!#')
    onData?.('\u001b[32m')

    expect(writeTerminalBackend).toHaveBeenCalledTimes(1)
    expect(writeTerminalBackend).toHaveBeenCalledWith('session-mouse-top', '\u001b[32m')
  })

  it('ignores duplicate resize observer measurements', async () => {
    renderTerminal({ terminalId: 'session-resize-case-top', sessionName: 'resize-case' })

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

  it('does not resize when a forced fit resolves to the current cols/rows (prevents scroll drift)', async () => {
    renderTerminal({ terminalId: 'session-force-fit-top', sessionName: 'force-fit' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalled()
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect(cleanupRegistryMock.addResizeObserver).toHaveBeenCalled()
      expect(cleanupRegistryMock.addEventListener).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const baselineResizes = instance.raw.resize.mock.calls.length

    instance.raw.buffer.active.baseY = 200
    instance.raw.buffer.active.viewportY = 123

    // If we accidentally call resize() even when cols/rows are unchanged, simulate the observed drift.
    instance.raw.resize.mockImplementation(function resize(this: HarnessInstance['raw'], cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
      this.buffer.active.viewportY = Math.max(0, this.buffer.active.viewportY - 1)
    })

    instance.fitAddon.proposeDimensions = vi.fn(() => ({ cols: instance.raw.cols, rows: instance.raw.rows }))

    const roCalls = cleanupRegistryMock.addResizeObserver.mock.calls
    const roLast = roCalls[roCalls.length - 1]
    const element = roLast?.[0] as HTMLDivElement | undefined
    expect(element).toBeDefined()
    Object.defineProperty(element!, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(element!, 'clientHeight', { configurable: true, value: 600 })

    const fontListenerCall = cleanupRegistryMock.addEventListener.mock.calls.find((call) => call[1] === 'font-size-changed')
    expect(fontListenerCall).toBeDefined()
    const fontSizeHandler = fontListenerCall?.[2] as ((ev: Event) => void) | undefined
    expect(fontSizeHandler).toBeTypeOf('function')

    vi.useFakeTimers()
    try {
      await act(async () => {
        fontSizeHandler?.(new CustomEvent('font-size-changed', { detail: { terminalFontSize: 13, uiFontSize: 13 } }))
        await vi.runOnlyPendingTimersAsync()
      })

      expect(instance.raw.resize.mock.calls.length).toBe(baselineResizes)
      expect(instance.raw.buffer.active.viewportY).toBe(123)

      await act(async () => {
        fontSizeHandler?.(new CustomEvent('font-size-changed', { detail: { terminalFontSize: 13, uiFontSize: 13 } }))
        await vi.runOnlyPendingTimersAsync()
      })

      expect(instance.raw.resize.mock.calls.length).toBe(baselineResizes)
      expect(instance.raw.buffer.active.viewportY).toBe(123)
    } finally {
      vi.useRealTimers()
    }
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

  it('pastes dropped file paths into the terminal input', async () => {
    const { container } = renderTerminal({ terminalId: 'session-drop-bottom', workingDirectory: '/repo' })

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

  it('opens absolute file links outside the active project root using the project root (not the worktree)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetActiveProjectPath) return '/project'
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'vscode'
      if (cmd === TauriCommands.OpenInApp) return undefined
      return { fontFamily: null }
    })

    renderTerminal({
      terminalId: 'session-file-links-bottom',
      workingDirectory: '/project/.schaltwerk/worktrees/session-a',
    })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect((terminalHarness.instances[0] as HarnessInstance).setFileLinkHandler).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const handler = instance.setFileLinkHandler.mock.calls.at(-1)?.[0] as ((text: string) => Promise<boolean>) | null | undefined
    expect(typeof handler).toBe('function')

    const handled = await handler!('/tmp/outside.log:12')
    expect(handled).toBe(true)

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.OpenInApp,
        expect.objectContaining({
          appId: 'vscode',
          worktreeRoot: '/project',
          worktreePath: '/project',
          targetPath: '/tmp/outside.log',
          line: 12,
        }),
      )
    })
  })

  it('opens absolute file links inside the active project root but outside the session root using the project root (not the worktree)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetActiveProjectPath) return '/project'
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'vscode'
      if (cmd === TauriCommands.OpenInApp) return undefined
      return { fontFamily: null }
    })

    renderTerminal({
      terminalId: 'session-file-links-project-bottom',
      workingDirectory: '/project/.schaltwerk/worktrees/session-a',
    })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect((terminalHarness.instances[0] as HarnessInstance).setFileLinkHandler).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const handler = instance.setFileLinkHandler.mock.calls.at(-1)?.[0] as ((text: string) => Promise<boolean>) | null | undefined
    expect(typeof handler).toBe('function')

    const handled = await handler!('/project/src/inside.ts:7')
    expect(handled).toBe(true)

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.OpenInApp,
        expect.objectContaining({
          appId: 'vscode',
          worktreeRoot: '/project',
          worktreePath: '/project',
          targetPath: '/project/src/inside.ts',
          line: 7,
        }),
      )
    })
  })

  it('opens relative file links that resolve outside the session root using the project root (not the worktree)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetActiveProjectPath) return '/project'
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'vscode'
      if (cmd === TauriCommands.OpenInApp) return undefined
      return { fontFamily: null }
    })

    renderTerminal({
      terminalId: 'session-file-links-relative-outside-bottom',
      workingDirectory: '/project/.schaltwerk/worktrees/session-a',
    })

    await waitFor(() => {
      expect(terminalHarness.instances.length).toBeGreaterThan(0)
      expect((terminalHarness.instances[0] as HarnessInstance).setFileLinkHandler).toHaveBeenCalled()
    })

    const instance = terminalHarness.instances[0] as HarnessInstance
    const handler = instance.setFileLinkHandler.mock.calls.at(-1)?.[0] as ((text: string) => Promise<boolean>) | null | undefined
    expect(typeof handler).toBe('function')

    const handled = await handler!('../outside.log:12')
    expect(handled).toBe(true)

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith(
        TauriCommands.OpenInApp,
        expect.objectContaining({
          appId: 'vscode',
          worktreeRoot: '/project',
          worktreePath: '/project',
          targetPath: '/project/.schaltwerk/worktrees/outside.log',
          line: 12,
        }),
      )
    })
  })

  it('does not restart agent when remounting a started terminal', async () => {
    const { isTerminalStartingOrStarted } = await import('../../common/terminalStartState')
    vi.mocked(isTerminalStartingOrStarted).mockReturnValue(true)
    vi.mocked(startSessionTop).mockClear()

    const { unmount } = renderTerminal({ terminalId: 'session-started-top', sessionName: 'started' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenCalledWith(
        'session-started-top',
        expect.any(Function)
      )
    })

    expect(startSessionTop).not.toHaveBeenCalled()

    unmount()

    vi.mocked(startSessionTop).mockClear()

    terminalHarness.setNextIsNew(false)
    registryMocks.hasTerminalInstance.mockReturnValue(true)
    renderTerminal({ terminalId: 'session-started-top', sessionName: 'started' })

    await waitFor(() => {
      expect(terminalHarness.acquireMock).toHaveBeenLastCalledWith(
        'session-started-top',
        expect.any(Function)
      )
    })

    expect(startSessionTop).not.toHaveBeenCalled()
  })
})
