import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TerminalViewportController } from './TerminalViewportController'

const buildMockTerminal = () => {
  const onScrollHandlers: Array<() => void> = []

  const raw = {
    buffer: {
      active: {
        baseY: 10,
        viewportY: 9,
        type: 'normal',
      },
    },
    onScroll: (cb: () => void) => {
      onScrollHandlers.push(cb)
      return { dispose: vi.fn() }
    },
    refresh: vi.fn(),
    scrollToBottom: vi.fn(),
  }

  const terminal = {
    raw,
    refresh: () => raw.refresh(),
    isTuiMode: () => false,
  }

  return { terminal, onScrollHandlers }
}

describe('TerminalViewportController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('resets scroll state and snaps on clear', () => {
    const { terminal } = buildMockTerminal()
    const controller = new TerminalViewportController({ terminal: terminal as unknown as import('../../../terminal/xterm/XtermTerminal').XtermTerminal })

    controller.onClear()

    expect(terminal.raw.refresh).toHaveBeenCalled()
    expect(terminal.raw.scrollToBottom).toHaveBeenCalled()
  })

  it('no-ops when disposed', () => {
    const { terminal } = buildMockTerminal()
    const controller = new TerminalViewportController({ terminal: terminal as unknown as import('../../../terminal/xterm/XtermTerminal').XtermTerminal })
    controller.dispose()

    controller.onClear()

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
