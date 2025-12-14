import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TerminalViewportController } from './TerminalViewportController'

vi.mock('../../../terminal/registry/terminalRegistry', () => ({
  isTerminalStreaming: vi.fn(() => false),
}))

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
    scrollToLine: vi.fn(),
  }

  const terminal = {
    raw,
    refresh: () => raw.refresh(),
    isTuiMode: () => false,
    forceScrollbarRefresh: vi.fn(),
  }

  return { terminal, buffer }
}

const TEST_TERMINAL_ID = 'test-terminal'

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
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
      expect(terminal.raw.refresh).toHaveBeenCalled()
    })

    it('coalesces multiple output calls into single RAF', async () => {
      const { terminal } = buildMockTerminal()
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onOutput()
      controller.onOutput()
      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.raw.refresh).toHaveBeenCalledTimes(1)
    })

    it('never calls forceScrollbarRefresh during output (VS Code pattern)', async () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.forceScrollbarRefresh).not.toHaveBeenCalled()
    })

    it('never calls forceScrollbarRefresh during output even at bottom', async () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 100 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onOutput()
      await vi.runAllTimersAsync()

      expect(terminal.forceScrollbarRefresh).not.toHaveBeenCalled()
    })
  })

  describe('onClear', () => {
    it('snaps to bottom on clear', () => {
      const { terminal } = buildMockTerminal()
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onClear()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })
  })

  describe('onFocusOrClick', () => {
    it('snaps to bottom when near bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onFocusOrClick()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })

    it('does not snap when far from bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onFocusOrClick()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
    })
  })

  describe('onResize', () => {
    it('snaps to bottom when near bottom and not streaming', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onResize()

      expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
    })

    it('does not snap during streaming', async () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.onOutput()
      await vi.runAllTimersAsync()
      terminal.raw.scrollToBottom.mockClear()

      controller.onResize()

      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
    })

    it('restores scroll position if user was scrolled away', () => {
      const { terminal, buffer } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.beforeResize()
      buffer.baseY = 110
      controller.onResize()

      expect(terminal.raw.scrollToLine).toHaveBeenCalled()
      expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
    })

    it('does not save scroll state if already at bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 100 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.beforeResize()
      controller.onResize()

      expect(terminal.raw.scrollToLine).not.toHaveBeenCalled()
    })
  })

  describe('scroll state save/restore', () => {
    it('saves and restores viewport position', () => {
      const { terminal, buffer } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.saveScrollState()
      buffer.viewportY = 80
      controller.restoreScrollState()

      expect(terminal.raw.scrollToLine).toHaveBeenCalledWith(50)
    })

    it('adjusts for buffer growth during restore', () => {
      const { terminal, buffer } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      controller.saveScrollState()
      buffer.baseY = 120
      buffer.viewportY = 80
      controller.restoreScrollState()

      expect(terminal.raw.scrollToLine).toHaveBeenCalledWith(70)
    })
  })

  describe('isAtBottom and isNearBottom', () => {
    it('isAtBottom returns true when at bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 100 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      expect(controller.isAtBottom()).toBe(true)
    })

    it('isAtBottom returns false when scrolled away', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      expect(controller.isAtBottom()).toBe(false)
    })

    it('isNearBottom returns true within threshold', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 98 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      expect(controller.isNearBottom()).toBe(true)
    })

    it('isNearBottom returns false when far from bottom', () => {
      const { terminal } = buildMockTerminal({ baseY: 100, viewportY: 50 })
      const controller = new TerminalViewportController({
        terminal: terminal as any,
        terminalId: TEST_TERMINAL_ID,
      })

      expect(controller.isNearBottom()).toBe(false)
    })
  })

  it('no-ops when disposed', async () => {
    const { terminal } = buildMockTerminal()
    const controller = new TerminalViewportController({
      terminal: terminal as any,
      terminalId: TEST_TERMINAL_ID,
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
    const controller = new TerminalViewportController({
      terminal: terminal as any,
      terminalId: TEST_TERMINAL_ID,
    })

    controller.onOutput()
    controller.onClear()

    expect(terminal.raw.refresh).not.toHaveBeenCalled()
    expect(terminal.raw.scrollToBottom).not.toHaveBeenCalled()
  })
})
