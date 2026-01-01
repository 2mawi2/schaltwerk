import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

const initMock = vi.fn().mockResolvedValue(undefined)
const registerLinkProviderMock = vi.fn()

vi.mock('ghostty-web', () => {
  const instances: unknown[] = []

  class MockTerminal {
    static __instances = instances
    cols = 80
    rows = 24
    viewportY = 0
    element: HTMLElement | null = null
    options: Record<string, unknown>
    selectionManager = {
      hasSelection: vi.fn(() => false),
      clearSelection: vi.fn(),
      selectionStart: null as null | { col: number; absoluteRow: number },
      selectionEnd: null as null | { col: number; absoluteRow: number },
    }
    wasmTerm = {
      getScrollbackLength: vi.fn(() => 10),
    }

    loadAddon = vi.fn()
    open = vi.fn((parent: HTMLElement) => {
      this.element = parent
    })
    write = vi.fn()
    dispose = vi.fn()
    scrollToLine = vi.fn()
    getViewportY = vi.fn(() => this.viewportY)
    registerLinkProvider = registerLinkProviderMock

    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }
  }

  class MockFitAddon {
    fit = vi.fn()
    dispose = vi.fn()
    activate = vi.fn()
  }

  return {
    init: initMock,
    Terminal: MockTerminal,
    FitAddon: MockFitAddon,
  }
})

beforeEach(() => {
  initMock.mockClear()
  registerLinkProviderMock.mockClear()
})

describe('XtermTerminal wrapper (ghostty-web)', () => {
  it('initializes ghostty-web, creates a terminal instance, and registers link providers on first attach', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')
    const { theme } = await import('../../common/theme')

    await XtermTerminal.ensureInitialized()
    expect(initMock).toHaveBeenCalledTimes(1)

    const wrapper = new XtermTerminal({
      terminalId: 'test-id',
      config: {
        scrollback: 12000,
        fontSize: 14,
        fontFamily: 'Fira Code',
        readOnly: false,
        minimumContrastRatio: 1.3,
        smoothScrolling: true,
      },
    })

    const { Terminal: MockTerminal } = await import('ghostty-web') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown>; loadAddon: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> }> }
    }
    expect(MockTerminal.__instances).toHaveLength(1)
    const instance = MockTerminal.__instances[0]
    expect(instance.options.scrollback).toBe(12000)
    expect(instance.options.fontSize).toBe(14)
    expect(instance.options.fontFamily).toBe('Fira Code')
    expect(instance.options.disableStdin).toBe(false)
    expect(instance.options.smoothScrollDuration).toBeGreaterThan(0)
    expect(instance.options.theme).toMatchObject({
      background: theme.colors.background.secondary,
      foreground: theme.colors.text.primary,
      brightRed: theme.colors.accent.red.light,
    })
    expect(instance.loadAddon).toHaveBeenCalledTimes(1)
    expect(registerLinkProviderMock).toHaveBeenCalledTimes(0)

    const container = document.createElement('div')
    wrapper.attach(container)

    expect(container.children).toHaveLength(1)
    const child = container.children[0] as HTMLElement
    expect(child.dataset.terminalId).toBe('test-id')
    expect(child.classList.contains('schaltwerk-terminal-wrapper')).toBe(true)
    expect(child.style.position).toBe('relative')
    expect(child.style.width).toBe('100%')
    expect(child.style.height).toBe('100%')
    expect(child.style.display).toBe('block')

    expect(instance.open).toHaveBeenCalledTimes(1)
    expect(registerLinkProviderMock).toHaveBeenCalledTimes(2)

    wrapper.detach()
    expect((child as HTMLElement).style.display).toBe('none')

    wrapper.attach(container)
    expect((child as HTMLElement).style.display).toBe('block')
    expect(instance.open).toHaveBeenCalledTimes(1)
  })

  it('updates underlying terminal options via updateOptions', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    await XtermTerminal.ensureInitialized()
    const wrapper = new XtermTerminal({
      terminalId: 'opts',
      config: {
        scrollback: 10000,
        fontSize: 13,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('ghostty-web') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!
    expect(instance.options.fontSize).toBe(13)

    wrapper.updateOptions({ fontSize: 17, fontFamily: 'Fira Code' })
    expect(instance.options.fontSize).toBe(17)
    expect(instance.options.fontFamily).toBe('Fira Code')
  })

  it('hides the cursor in TUI mode on attach', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    await XtermTerminal.ensureInitialized()
    const wrapper = new XtermTerminal({
      terminalId: 'tui',
      uiMode: 'tui',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('ghostty-web') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown>; write: ReturnType<typeof vi.fn> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const container = document.createElement('div')
    wrapper.attach(container)

    expect(instance.options.cursorBlink).toBe(false)
    expect(instance.write).toHaveBeenCalledWith('\x1b[?25l')
  })

  it('saves and restores scroll position on detach/attach', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    await XtermTerminal.ensureInitialized()
    const wrapper = new XtermTerminal({
      terminalId: 'scroll-test',
      config: {
        scrollback: 4000,
        fontSize: 12,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
        smoothScrolling: false,
      },
    })

    const { Terminal: MockTerminal } = await import('ghostty-web') as unknown as {
      Terminal: { __instances: Array<{ viewportY: number; scrollToLine: ReturnType<typeof vi.fn> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    const container = document.createElement('div')
    wrapper.attach(container)

    instance.viewportY = 7
    wrapper.detach()

    wrapper.attach(container)
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(instance.scrollToLine).toHaveBeenCalledWith(7)
  })
})
