import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalViewportController } from './TerminalViewportController'

const buildMockTerminal = (options?: { baseY?: number; viewportY?: number }) => {
  const buffer = {
    baseY: options?.baseY ?? 10,
    viewportY: options?.viewportY ?? 10,
    type: 'normal' as const,
  }

  const raw = {
    buffer: { active: buffer },
    refresh: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
  }

  const terminal = {
    raw,
    refresh: () => raw.refresh(),
    isTuiMode: () => false,
  }

  return { terminal, buffer }
}

describe('TerminalViewportController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('onOutput', () => {
    it('never calls scrollToBottom during output', async () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
      expect(terminal.raw.refresh).toHaveBeenCalled()
    })

    it('coalesces multiple output calls into single RAF', async () => {
      const { terminal } = buildMockTerminal()
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onOutput()
      controller.onOutput()
      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.raw.refresh).toHaveBeenCalledTimes(1)
    })
  })

  describe('onClear', () => {
    it('snaps to bottom on clear', () => {
      const { terminal } = buildMockTerminal()
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onClear()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })
  })

  describe('onFocusOrClick', () => {
    it('snaps to bottom when near bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onFocusOrClick()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })

    it('does not snap when far from bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onFocusOrClick()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('onResize', () => {
    it('snaps to bottom when near bottom and not streaming', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onResize()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })

    it('does not snap during streaming', async () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any
      })

      controller.onOutput()
      await vi.runAllTimersAsync()
      terminal.raw.scrollToBottom.mockClear()

      controller.onResize()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
    })
  })

  it('no-ops when disposed', async () => {
    const { terminal } = buildMockTerminal()
    const controller = new TerminalViewportController({
      terminal: terminal as any
    })
    controller.dispose()

    controller.onOutput()
    controller.onClear()
    await vi.runAllTimersAsync()

    expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
  })

  it('skips output and clear handling in TUI mode', () => {
    const { terminal } = buildMockTerminal()
    terminal.isTuiMode = () => true
    const controller = new TerminalViewportController({ terminal: terminal as unknown as import('../../../terminal/xterm/XtermTerminal').XtermTerminal })

    controller.onOutput()
    controller.onClear()

    expect(terminal.raw.refresh).not.toHaveBeenCalled()
    expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
  })
})
