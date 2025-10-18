import { render, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockTauriInvokeArgs } from '../../types/testing'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import { resetSplitDragForTests } from '../../utils/splitDragCoordinator'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { clearGpuRendererRegistry } from '../../terminal/gpu/gpuRendererRegistry'

// Type definitions for mocks
interface MockTauriCore {
  invoke: ReturnType<typeof vi.fn>
  __setInvokeHandler: (cmd: string, handler: (args: MockTauriInvokeArgs) => unknown | Promise<unknown>) => void
  __clearInvokeHandlers: () => void
}

interface MockTauriEvent {
  listen: ReturnType<typeof vi.fn>
  __emit: (event: string, payload: unknown) => void
  __clear: () => void
}

interface MockFitAddonModule {
  FitAddon: new () => unknown
  __setNextFitSize: (size: { cols: number; rows: number } | null) => void
}

interface MockXTerm {
  options: Record<string, unknown>
  cols: number
  rows: number
  write: ReturnType<typeof vi.fn>
  keyHandler: ((e: KeyboardEvent) => boolean) | null
  dataHandler: ((d: string) => void) | null
  loadAddon: ReturnType<typeof vi.fn>
  buffer: {
    active: {
      viewportY: number
      length: number
      baseY: number
      cursorY: number
    }
  }
  parser: {
    registerOscHandler: ReturnType<typeof vi.fn>
  }
  __triggerData: (d: string) => void
  __triggerKey: (e: KeyboardEvent) => boolean
  focus: () => void
  scrollToBottom: () => void
  scrollToLine: ReturnType<typeof vi.fn>
  scrollLines: ReturnType<typeof vi.fn>
  dispose: () => void
  resize: (cols: number, rows: number) => void
  __setTrailingBlankLines: (n: number) => void
}


// Mocks must be declared before importing the component under test

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('@xterm/addon-webgl', () => {
  return {
    WebglAddon: class {
      clearTextureAtlas = vi.fn()
      dispose = vi.fn()
      onContextLoss = vi.fn()
    }
  }
})

// ---- Mock: xterm (defined entirely inside factory to avoid hoist issues) ----
vi.mock('@xterm/xterm', () => {
  const instances: unknown[] = []
  class MockXTerm {
    static __instances = instances
    options: Record<string, unknown>
    cols = 80
    rows = 24
    write = vi.fn((_d?: string, cb?: () => void) => {
      if (typeof cb === 'function') cb()
      return undefined as unknown as void
    })
    keyHandler: ((e: KeyboardEvent) => boolean) | null = null
    dataHandler: ((d: string) => void) | null = null
    loadAddon = vi.fn()
    __blankTail = 0
    buffer = {
      active: {
        viewportY: 0,
        length: 100,
        baseY: 0,
        cursorY: 0,
        getLine: (idx: number) => {
          const isBlank = idx >= (this.buffer.active.length - this.__blankTail)
          return {
            translateToString: () => (isBlank ? '   ' : 'content')
          }
        }
      }
    }
    parser = {
      registerOscHandler: vi.fn()
    }
    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }
    open(_el: HTMLElement) {}
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) {
      this.keyHandler = fn
      return true
    }
    onData(fn: (d: string) => void) {
      this.dataHandler = fn
    }
    scrollToBottom() {}
    scrollLines = vi.fn()
    scrollToLine = vi.fn((line: number) => {
      const delta = line - this.buffer.active.viewportY
      if (delta !== 0) {
        this.scrollLines(delta)
        this.buffer.active.viewportY = line
      }
    })
    focus() {}
    dispose() {}
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    }
    __setTrailingBlankLines(n: number) {
      this.__blankTail = Math.max(0, n)
    }
    __triggerData(d: string) {
      this.dataHandler?.(d)
    }
    __triggerKey(e: KeyboardEvent) {
      return this.keyHandler ? this.keyHandler(e) : true
    }
  }
  function __getLastInstance() {
    return instances[instances.length - 1]
  }
  return {
    Terminal: MockXTerm,
    __xtermInstances: instances,
    __getLastInstance,
  }
})

// ---- Mock: @xterm/addon-fit ----
vi.mock('@xterm/addon-fit', () => {
  let nextFitSize: { cols: number; rows: number } | null = null
  class MockFitAddon {
    activate() {
      // Mock addon activation - required by xterm addon interface
    }
    fit() {
      // import lazily to avoid circular init
      const xterm = require('@xterm/xterm') as { __getLastInstance?: () => MockXTerm }
      const last = xterm.__getLastInstance?.()
      if (nextFitSize && last) {
        last.cols = nextFitSize.cols
        last.rows = nextFitSize.rows
      }
    }
  }
  function __setNextFitSize(size: { cols: number; rows: number } | null) {
    nextFitSize = size
  }
  return {
    FitAddon: MockFitAddon,
    __setNextFitSize,
  }
})

// ---- Mock: @xterm/addon-search ----
vi.mock('@xterm/addon-search', () => {
  const instances: MockSearchAddon[] = []
  class MockSearchAddon {
    findNext = vi.fn()
    findPrevious = vi.fn()
    constructor() {
      instances.push(this)
    }
    activate() {
      // Mock addon activation - required by xterm addon interface
    }
  }
  function __getLastSearchAddon() {
    return instances[instances.length - 1]
  }
  return {
    SearchAddon: MockSearchAddon,
    __getLastSearchAddon,
  }
})


// ---- Mock: @tauri-apps/api/core (invoke) ----
vi.mock('@tauri-apps/api/core', () => {
  const handlers = new Map<string, (args: MockTauriInvokeArgs) => unknown | Promise<unknown>>()
  const invoke = vi.fn(async (cmd: string, args?: MockTauriInvokeArgs) => {
    const h = handlers.get(cmd)
    if (h) return await h(args || {})
    return undefined
  })
  function __setInvokeHandler(cmd: string, handler: (args: MockTauriInvokeArgs) => unknown | Promise<unknown>) {
    handlers.set(cmd, handler)
  }
  function __clearInvokeHandlers() {
    handlers.clear()
  }
  return {
    invoke,
    __setInvokeHandler,
    __clearInvokeHandlers,
  }
})

// ---- Mock: @tauri-apps/api/event (listen) ----
vi.mock('@tauri-apps/api/event', () => {
  const listenerMap = new Map<string, Array<(evt: { event: string; payload: unknown }) => void>>()
  const SAFE_PATTERN = /[^a-zA-Z0-9/:_-]/g
  const normalize = (event: string) => {
    if (event.startsWith('terminal-output-')) {
      const prefix = 'terminal-output-'
      return `${prefix}${event.slice(prefix.length).replace(SAFE_PATTERN, '_')}`
    }
    if (event.startsWith('terminal-output-normalized-')) {
      const prefix = 'terminal-output-normalized-'
      return `${prefix}${event.slice(prefix.length).replace(SAFE_PATTERN, '_')}`
    }
    return event
  }
  const listen = vi.fn(async (channel: string, cb: (evt: { event: string; payload: unknown }) => void) => {
    const normalized = normalize(channel)
    const arr = listenerMap.get(normalized) ?? []
    arr.push(cb)
    listenerMap.set(normalized, arr)
    return () => {
      const list = listenerMap.get(normalized) ?? []
      const idx = list.indexOf(cb)
      if (idx >= 0) list.splice(idx, 1)
      listenerMap.set(normalized, list)
    }
  })
  function __emit(event: string, payload: unknown) {
    const normalized = normalize(event)
    const arr = listenerMap.get(normalized) ?? []
    for (const cb of arr) cb({ event: normalized, payload })
  }
  function __clear() {
    listenerMap.clear()
  }
  return {
    listen,
    __emit,
    __clear,
  }
})

// ---- Global ResizeObserver mock ----
class MockResizeObserver {
  cb: (entries?: ResizeObserverEntry[]) => void
  constructor(cb: (entries?: ResizeObserverEntry[]) => void) {
    this.cb = cb
    ;(globalThis as Record<string, unknown>).__lastRO = this
  }
  observe() {}
  disconnect() {}
  trigger(width = 1024, height = 768) {
    const entry = {
      contentRect: { width, height },
    } as ResizeObserverEntry
    this.cb([entry])
  }
}
;(globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver as unknown






// Now import the component under test
import { Terminal } from './Terminal'
import { TestProviders } from '../../tests/test-utils'
// Also import mocked helpers for control
import * as TauriEvent from '@tauri-apps/api/event'
import * as TauriCore from '@tauri-apps/api/core'
import * as XTermModule from '@xterm/xterm'
import * as FitAddonModule from '@xterm/addon-fit'
import * as TerminalFonts from '../../utils/terminalFonts'
import { logger } from '../../utils/logger'

function getLastXtermInstance(): MockXTerm {
  return (XTermModule as unknown as { __getLastInstance: () => MockXTerm }).__getLastInstance()
}

async function flushAll() {
  await act(async () => {
    vi.runOnlyPendingTimers()
    await Promise.resolve()
  })
}

async function advanceAndFlush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await flushAll()
}

function setElementDimensions(el: HTMLElement | null, width: number, height: number) {
  if (!el) return
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(el, 'isConnected', { value: true, configurable: true })
}


beforeEach(() => {
  vi.useFakeTimers()
  resetSplitDragForTests()
  ;(TauriCore as unknown as MockTauriCore).invoke.mockClear()
  ;(TauriCore as unknown as MockTauriCore).__clearInvokeHandlers()
  ;(TauriEvent as unknown as MockTauriEvent).__clear()
  // sensible defaults
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.TerminalExists, () => true)
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.ResizeTerminal, () => undefined)
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.WriteTerminal, () => undefined)
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, () => undefined)
;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(
  TauriCommands.SchaltwerkCoreStartSessionAgent,
  () => undefined
)
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.GetTerminalBuffer, () => ({ seq: 0, startSeq: 0, data: '' }))
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.GetTerminalSettings, () => ({ fontFamily: null }))
  const mockFontSizes = [14, 14] as [number, number];
  ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.SchaltwerkCoreGetFontSizes, () => mockFontSizes)
  ;(FitAddonModule as unknown as MockFitAddonModule).__setNextFitSize(null)

  // Reset navigator for clean tests
  Object.defineProperty(window.navigator, 'userAgent', { 
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 
    configurable: true 
  })
})

function toStableTerminalId(legacyId: string | undefined): string | undefined {
  if (!legacyId || !legacyId.startsWith('session-')) return legacyId
  const prefixLength = 'session-'.length
  const hashedTopPattern = /^session-.*(?:-|~)[0-9a-f]{6}-top$/i
  const hashedBottomPattern = /^session-.*(?:-|~)[0-9a-f]{6}-bottom.*$/i
  if (hashedTopPattern.test(legacyId) || hashedBottomPattern.test(legacyId)) {
    return legacyId
  }
  if (legacyId.endsWith('-top')) {
    const name = legacyId.slice(prefixLength, -4)
    return stableSessionTerminalId(name, 'top')
  }
  const bottomIndex = legacyId.indexOf('-bottom')
  if (bottomIndex !== -1) {
    const name = legacyId.slice(prefixLength, bottomIndex)
    const suffix = legacyId.slice(bottomIndex + '-bottom'.length)
    return stableSessionTerminalId(name, 'bottom') + suffix
  }
  return legacyId
}

const stableId = (legacyId: string): string => toStableTerminalId(legacyId) ?? legacyId


// Helper function to render Terminal with all required providers
function renderTerminal(props: React.ComponentProps<typeof Terminal>) {
  const terminalId = toStableTerminalId(props.terminalId)
  return render(
    <TestProviders>
      <Terminal {...props} terminalId={terminalId ?? props.terminalId} />
    </TestProviders>
  )
}

describe('Terminal component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSplitDragForTests()
    ;(TauriCore as unknown as MockTauriCore).invoke.mockClear()
    ;(TauriCore as unknown as MockTauriCore).__clearInvokeHandlers()
    ;(TauriEvent as unknown as MockTauriEvent).__clear()
    // sensible defaults
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.TerminalExists, () => true)
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.ResizeTerminal, () => undefined)
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.WriteTerminal, () => undefined)
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, () => undefined)
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(
      TauriCommands.SchaltwerkCoreStartSessionAgent,
      () => undefined
    )
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.GetTerminalSettings, () => ({ fontFamily: null }))
    const mockFontSizes = [14, 14] as [number, number]
    ;(TauriCore as unknown as MockTauriCore).__setInvokeHandler(TauriCommands.SchaltwerkCoreGetFontSizes, () => mockFontSizes)
    ;(FitAddonModule as unknown as MockFitAddonModule).__setNextFitSize(null)

  })

  afterEach(() => {
    vi.useRealTimers()
    ;(FitAddonModule as unknown as MockFitAddonModule).__setNextFitSize(null)
    ;(TauriEvent as unknown as MockTauriEvent).__clear()
    ;(TauriCore as unknown as MockTauriCore).__clearInvokeHandlers()
    clearGpuRendererRegistry()
  })

  it('writes output received via terminal events', async () => {
    renderTerminal({ terminalId: 'session-basic-top', sessionName: 'basic' })
    await flushAll()

    const xterm = getLastXtermInstance()
    ;(xterm.write as unknown as ReturnType<typeof vi.fn>).mockClear()

    ;(TauriEvent as unknown as MockTauriEvent).__emit(`terminal-output-${stableId('session-basic-top')}`, 'HELLO')
    await advanceAndFlush(200)

    const writes = (xterm.write as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(call => call[0] as string)
      .join('')
    expect(writes).toContain('HELLO')
  })

  it('hydrates buffered output before subscribing to streaming events', async () => {
    const core = TauriCore as unknown as MockTauriCore
    core.__setInvokeHandler(TauriCommands.GetTerminalBuffer, () => ({
      seq: 5,
      startSeq: 0,
      data: 'SNAPSHOT\n',
    }))

    renderTerminal({ terminalId: 'session-hydrate-top', sessionName: 'hydrate' })
    await advanceAndFlush(200)

    const xterm = getLastXtermInstance()
    const writes = (xterm.write as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(call => call[0] as string)
      .join('')
    expect(writes).toContain('SNAPSHOT')
  })

  it('updates terminal font family when settings and runtime events change', async () => {
    const core = TauriCore as unknown as MockTauriCore
    const fontSpy = vi.spyOn(TerminalFonts, 'buildTerminalFontFamily')
    core.__setInvokeHandler(TauriCommands.GetTerminalSettings, () => ({ fontFamily: 'Victor Mono' }))

    const { container } = renderTerminal({ terminalId: 'session-font-top', sessionName: 'font' })
    await advanceAndFlush(100)

    const outer = container.querySelector('[data-smartdash-exempt="true"]') as HTMLDivElement | null
    const termEl = outer?.querySelector('div') as HTMLDivElement | null
    setElementDimensions(outer, 800, 480)
    setElementDimensions(termEl, 800, 480)

    const xterm = getLastXtermInstance()
    expect(String(xterm.options.fontFamily)).toContain('Victor Mono')
    expect(fontSpy).toHaveBeenCalledWith('Victor Mono')

    emitUiEvent(UiEvent.TerminalFontUpdated, { fontFamily: 'Cousine' })
    await flushAll()
    await advanceAndFlush(50)
    await flushAll()
    expect(fontSpy).toHaveBeenCalledWith('Cousine')
    fontSpy.mockRestore()
  })

  it('emits debug logs when TERMINAL_DEBUG flag is set', async () => {
    window.localStorage.setItem('TERMINAL_DEBUG', '1')
    const debugSpy = vi.spyOn(logger, 'debug')

    renderTerminal({ terminalId: 'session-debug-top', sessionName: 'debug' })
    await flushAll()

    ;(TauriEvent as unknown as MockTauriEvent).__emit(`terminal-output-${stableId('session-debug-top')}`, 'DEBUGDATA')
    await advanceAndFlush(200)

    expect(debugSpy).toHaveBeenCalled()
    window.localStorage.removeItem('TERMINAL_DEBUG')
    debugSpy.mockRestore()
  })
});
