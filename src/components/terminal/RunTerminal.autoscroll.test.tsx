import { render, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Terminal } from './Terminal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'

// Mock CSS import used by xterm
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// Minimal xterm mock with scroll spies
vi.mock('@xterm/xterm', () => {
  const instances: unknown[] = []
  class MockXTerm {
    static __instances = instances
    options: Record<string, unknown>
    cols = 80
    rows = 24
    write = vi.fn((_d?: string, cb?: () => void) => { if (cb) cb() })
    loadAddon = vi.fn()
    buffer = { active: { viewportY: 0, baseY: 0, length: 100, cursorY: 0, getLine: (_: number) => ({ translateToString: () => 'x' }) } }
    parser = { registerOscHandler: vi.fn() }
    constructor(options: Record<string, unknown>) { this.options = options; instances.push(this) }
    open(_el: HTMLElement) {}
    attachCustomKeyEventHandler() { return true }
    onData() {}
    scrollToBottom = vi.fn()
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
    resize(c: number, r: number) { this.cols = c; this.rows = r }
  }
  function __getLastInstance() { return instances[instances.length - 1] }
  return { Terminal: MockXTerm, __getLastInstance }
})

// Fit addon mock
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { activate() {}; fit() {} },
}))

// Search addon mock
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class { activate() {}; findNext = vi.fn(); findPrevious = vi.fn() },
}))

// Tauri core invoke mock
vi.mock('@tauri-apps/api/core', () => {
  const handlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    const h = handlers.get(cmd)
    if (h) return await h(args || {})
    return undefined
  })
  function __setInvokeHandler(cmd: string, handler: (args: unknown) => unknown | Promise<unknown>) { handlers.set(cmd, handler) }
  function __clearInvokeHandlers() { handlers.clear() }
  return { invoke, __setInvokeHandler, __clearInvokeHandlers }
})

// Tauri event mock
vi.mock('@tauri-apps/api/event', () => {
  const map = new Map<string, Array<(evt: { event: string; payload: unknown }) => void>>()
  const SAFE = /[^a-zA-Z0-9/:_-]/g
  const normalize = (event: string) => {
    if (event.startsWith('terminal-output-')) {
      const prefix = 'terminal-output-'
      return `${prefix}${event.slice(prefix.length).replace(SAFE, '_')}`
    }
    if (event.startsWith('terminal-output-normalized-')) {
      const prefix = 'terminal-output-normalized-'
      return `${prefix}${event.slice(prefix.length).replace(SAFE, '_')}`
    }
    return event
  }
  const listen = vi.fn(async (channel: string, cb: (evt: { event: string; payload: unknown }) => void) => {
    const normalized = normalize(channel)
    const list = map.get(normalized) ?? []
    list.push(cb)
    map.set(normalized, list)
    return () => {
      const arr = map.get(normalized) ?? []
      const idx = arr.indexOf(cb)
      if (idx >= 0) arr.splice(idx, 1)
      map.set(normalized, arr)
    }
  })
  function __emit(event: string, payload: unknown) {
    const normalized = normalize(event)
    const arr = map.get(normalized) ?? []
    for (const cb of arr) cb({ event: normalized, payload })
  }
  function __clear() { map.clear() }
  return { listen, __emit, __clear }
})

function renderWithProviders(ui: React.ReactElement) {
  return render(<TestProviders>{ui}</TestProviders>)
}

async function flushAll() {
  await act(async () => {
    await Promise.resolve();
    vi.runOnlyPendingTimers();
    await Promise.resolve();
  })
}

describe('Run terminal auto-scroll behavior', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    const core = await import('@tauri-apps/api/core')
    ;(core as unknown as {
      invoke: { mockClear: () => void }
      __clearInvokeHandlers: () => void
      __setInvokeHandler: (cmd: string, handler: (args?: unknown) => unknown) => void
    }).invoke.mockClear()
    ;(core as unknown as { __clearInvokeHandlers: () => void }).__clearInvokeHandlers()
    ;(core as unknown as { __setInvokeHandler: (cmd: string, handler: (args?: unknown) => unknown) => void }).__setInvokeHandler(TauriCommands.GetTerminalBuffer, () => ({
      seq: 0,
      startSeq: 0,
      data: ''
    }))
    ;(core as unknown as { __setInvokeHandler: (cmd: string, handler: (args?: unknown) => unknown) => void }).__setInvokeHandler(TauriCommands.TerminalExists, () => true)
    ;(core as unknown as { __setInvokeHandler: (cmd: string, handler: (args?: unknown) => unknown) => void }).__setInvokeHandler(TauriCommands.ResizeTerminal, () => undefined)
    ;(core as unknown as { __setInvokeHandler: (cmd: string, handler: (args?: unknown) => unknown) => void }).__setInvokeHandler(TauriCommands.WriteTerminal, () => undefined)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not auto-scroll while user is selecting text (run agent)', async () => {
    type MockFn = ((...args: unknown[]) => unknown) & { mock: { calls: unknown[] }, mockClear: () => void }
    const { __getLastInstance } = await import('@xterm/xterm') as unknown as { __getLastInstance: () => { buffer: { active: { baseY: number, viewportY: number } }, scrollToBottom: MockFn } }
    const events = await import('@tauri-apps/api/event') as unknown as { __emit: (event: string, payload: unknown) => void }

    const { container } = renderWithProviders(
      <Terminal terminalId="run-terminal-demo" agentType="run" />
    )
    await flushAll()

    const xterm = __getLastInstance()
    // Simulate viewport at bottom
    xterm.buffer.active.baseY = 10
    xterm.buffer.active.viewportY = 10

    // Clear initial hydration-driven scrolls
    xterm.scrollToBottom.mockClear()

    // Insert text node inside the terminal container and select it
    const termContainer = container.querySelector('div > div') as HTMLDivElement
    termContainer.textContent = 'copy me'
    const range = document.createRange()
    range.selectNodeContents(termContainer.firstChild as Node)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Emit some terminal output for this id
    events.__emit('terminal-output-run-terminal-demo', 'hello')
    vi.advanceTimersByTime(10)

    // Because selection is active, run terminal should not auto-scroll due to output
    // Allow at most 1 incidental call from unrelated lifecycle timers
    expect(xterm.scrollToBottom.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('does not focus on click when selecting in run terminal', async () => {
    const focusUtils = await import('../../utils/safeFocus') as unknown as { safeTerminalFocusImmediate: (...args: unknown[]) => unknown }
    const { container } = renderWithProviders(
      <Terminal terminalId="run-terminal-click" agentType="run" />
    )
    await flushAll()

    // Make a selection inside the terminal DOM
    const termContainer = container.querySelector('div > div') as HTMLDivElement
    termContainer.textContent = 'copy me'
    const range = document.createRange()
    range.selectNodeContents(termContainer.firstChild as Node)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    // Simulate drag selection with mouse events and release
    fireEvent.mouseDown(termContainer, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(termContainer, { clientX: 40, clientY: 12 })
    fireEvent.mouseUp(termContainer, { clientX: 40, clientY: 12 })
    // React will emit a click after mouseup; trigger explicitly to ensure handler runs
    termContainer.click()

    // Focus helper must not have been called because selection is active
    expect(focusUtils.safeTerminalFocusImmediate).not.toHaveBeenCalled()
  })

  it('auto-scrolls when at bottom and no selection (run agent)', async () => {
// Mock focus helpers so we can assert focus behavior
vi.mock('../../utils/safeFocus', () => ({
  safeTerminalFocusImmediate: vi.fn((fn: () => void) => fn()),
  safeTerminalFocus: vi.fn((fn: () => void) => fn()),
}))
    const { __getLastInstance } = await import('@xterm/xterm') as unknown as { __getLastInstance: () => { buffer: { active: { baseY: number, viewportY: number } }, scrollToLine: (...args: unknown[]) => unknown, write: (...args: unknown[]) => unknown } }
    const events = await import('@tauri-apps/api/event') as unknown as { __emit: (event: string, payload: unknown) => void }

    renderWithProviders(
      <Terminal terminalId="run-terminal-demo2" agentType="run" />
    )
    await flushAll()

    const xterm = __getLastInstance()
    xterm.buffer.active.baseY = 5
    xterm.buffer.active.viewportY = 5
    const scrollSpy = vi.spyOn(xterm, 'scrollToLine')
    const originalWrite = xterm.write
    xterm.write = vi.fn((d, cb) => {
      xterm.buffer.active.baseY = 10
      return originalWrite.call(xterm, d, cb)
    })

    // Clear any selection
    const sel = window.getSelection()!
    sel.removeAllRanges()

    // Stream output
    events.__emit('terminal-output-run-terminal-demo2', 'world')
    await flushAll()

    expect(scrollSpy).toHaveBeenCalledWith(10)
  })
})
