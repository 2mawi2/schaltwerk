import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@xterm/xterm', () => {
  const instances: unknown[] = []
  class MockXTerm {
    static __instances = instances
    options: Record<string, unknown>
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    element: HTMLElement | null = null
    parser = {
      registerOscHandler: vi.fn(() => true),
    }
    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }
  }
  return { Terminal: MockXTerm }
})

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext = vi.fn()
    findPrevious = vi.fn()
    dispose = vi.fn()
  },
}))

const registerMock = vi.fn()

vi.mock('./xtermAddonImporter', () => ({
  XtermAddonImporter: class {
    static registerPreloadedAddon = registerMock
  }
}))

beforeEach(() => {
  registerMock.mockClear()
})

describe('XtermTerminal wrapper', () => {
  it('creates a terminal instance, loads addons, and attaches to a container', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')
    const { theme } = await import('../../common/theme')

    const wrapper = new XtermTerminal({
      terminalId: 'test-id',
      config: {
        scrollback: 12000,
        fontSize: 14,
        fontFamily: 'Fira Code',
        readOnly: false,
        minimumContrastRatio: 1.3,
      },
    })
    await wrapper.ensureCoreAddonsLoaded()

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown>; loadAddon: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn>; parser: { registerOscHandler: ReturnType<typeof vi.fn> } }> }
    }
    expect(MockTerminal.__instances).toHaveLength(1)
    const instance = MockTerminal.__instances[0]
    expect(instance.options.scrollback).toBe(12000)
    expect(instance.options.fontSize).toBe(14)
    expect(instance.options.fontFamily).toBe('Fira Code')
    expect(instance.options.disableStdin).toBe(false)
    expect(instance.options.minimumContrastRatio).toBe(1.3)
    expect(instance.options.theme).toMatchObject({
      background: theme.colors.background.secondary,
      foreground: theme.colors.text.primary,
      brightRed: theme.colors.accent.red.light,
    })
    expect(instance.loadAddon).toHaveBeenCalledTimes(2)
    expect(registerMock).toHaveBeenCalledWith('fit', expect.any(Function))
    expect(registerMock).toHaveBeenCalledWith('search', expect.any(Function))
    expect(instance.parser.registerOscHandler).toHaveBeenCalledTimes(9)
    for (const code of [10, 11, 12, 13, 14, 15, 16, 17, 19]) {
      expect(instance.parser.registerOscHandler).toHaveBeenCalledWith(code, expect.any(Function))
    }

    const container = document.createElement('div')
    wrapper.attach(container)

    expect(container.children).toHaveLength(1)
    const child = container.children[0] as HTMLElement
    expect(child.dataset.terminalId).toBe('test-id')
    expect(instance.open).toHaveBeenCalledTimes(1)
    expect((child as HTMLElement).style.display).toBe('flex')

    wrapper.detach()
    expect((child as HTMLElement).style.display).toBe('none')

    wrapper.attach(container)
    expect((child as HTMLElement).style.display).toBe('flex')
    expect(instance.open).toHaveBeenCalledTimes(1)
  })

  it('updates underlying xterm options via updateOptions', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'opts',
      config: {
        scrollback: 10000,
        fontSize: 13,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
      },
    })
    await wrapper.ensureCoreAddonsLoaded()
    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!
    expect(instance.options.fontSize).toBe(13)

    wrapper.updateOptions({ fontSize: 17, fontFamily: 'Fira Code' })
    expect(instance.options.fontSize).toBe(17)
    expect(instance.options.fontFamily).toBe('Fira Code')
  })

  it('applies config updates through applyConfig and updateOptions', async () => {
    const { XtermTerminal } = await import('./XtermTerminal')

    const wrapper = new XtermTerminal({
      terminalId: 'cfg',
      config: {
        scrollback: 10000,
        fontSize: 13,
        fontFamily: 'Menlo',
        readOnly: false,
        minimumContrastRatio: 1.0,
      },
    })

    const { Terminal: MockTerminal } = await import('@xterm/xterm') as unknown as {
      Terminal: { __instances: Array<{ options: Record<string, unknown> }> }
    }
    const instance = MockTerminal.__instances.at(-1)!

    wrapper.applyConfig({ readOnly: true, minimumContrastRatio: 1.6, scrollback: 12000 })
    expect(instance.options.disableStdin).toBe(true)
    expect(instance.options.minimumContrastRatio).toBe(1.6)
    expect(instance.options.scrollback).toBe(12000)

    wrapper.updateOptions({ disableStdin: false, scrollback: 8000 })
    expect(instance.options.disableStdin).toBe(false)
    expect(instance.options.scrollback).toBe(8000)
  })
})
