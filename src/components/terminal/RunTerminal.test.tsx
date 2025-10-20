 import { TauriCommands } from '../../common/tauriCommands'
 import { useRef } from 'react'
 import { vi, beforeEach } from 'vitest'
 import { render, screen, act, waitFor } from '@testing-library/react'
import { RunTerminal, type RunTerminalHandle } from './RunTerminal'

const RUN_EXIT_PRINTF_PATTERN = '__SCHALTWERK_RUN_EXIT__='

const pluginTransportHarness = vi.hoisted(() => {
  let enabled = false
  const subscribers = new Map<string, (message: { seq: number; bytes: Uint8Array }) => void>()
  const mockTransport = {
    spawn: vi.fn(async () => ({ termId: 'run-terminal-test' })),
    write: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    kill: vi.fn(async () => {}),
    subscribe: vi.fn(async (id: string, _seq: number, onData: (message: { seq: number; bytes: Uint8Array }) => void) => {
      subscribers.set(id, onData)
      return async () => {
        subscribers.delete(id)
      }
    }),
    ack: vi.fn(async () => {}),
  }
  return {
    mockTransport,
    subscribers,
    setEnabled(value: boolean) {
      enabled = value
    },
    isEnabled() {
      return enabled
    },
    reset() {
      enabled = false
      subscribers.clear()
      mockTransport.spawn.mockClear()
      mockTransport.write.mockClear()
      mockTransport.resize.mockClear()
      mockTransport.kill.mockClear()
      mockTransport.subscribe.mockClear()
      mockTransport.ack.mockClear()
    },
  }
})

const terminalOutputHarness = vi.hoisted(() => {
  const listeners = new Map<string, Set<(chunk: string) => void>>()
  return {
    add(id: string, listener: (chunk: string) => void) {
      let set = listeners.get(id)
      if (!set) {
        set = new Set()
        listeners.set(id, set)
      }
      set.add(listener)
    },
    remove(id: string, listener: (chunk: string) => void) {
      const set = listeners.get(id)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) {
        listeners.delete(id)
      }
    },
    emit(id: string, chunk: string) {
      const set = listeners.get(id)
      if (!set) return
      for (const listener of set) {
        listener(chunk)
      }
    },
    reset() {
      listeners.clear()
    }
  }
})

vi.mock('../../terminal/transport/transportFlags', () => ({
  shouldUsePluginTransport: vi.fn(async () => pluginTransportHarness.isEnabled()),
  getPluginTransport: vi.fn(async () => (pluginTransportHarness.isEnabled() ? pluginTransportHarness.mockTransport : null)),
  __setPluginEnabled: (value: boolean) => {
    pluginTransportHarness.setEnabled(value)
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === TauriCommands.GetProjectRunScript) {
      return { command: 'bun run dev', environmentVariables: {} }
    }
    if (cmd === TauriCommands.TerminalExists) return false
    if (cmd === TauriCommands.CreateRunTerminal) return 'run-terminal-test'
    if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
    return undefined
  })
}))

// Mock tauri event layer so listen resolves with a controllable unlisten
const eventHandlers: Record<string, ((e: unknown) => void) | null> = {}
const EVENT_NAME_SAFE_PATTERN = /[^a-zA-Z0-9/:_-]/g
const normalizeEventName = (event: string) => {
  if (event.startsWith('terminal-output-')) {
    const prefix = 'terminal-output-'
    return `${prefix}${event.slice(prefix.length).replace(EVENT_NAME_SAFE_PATTERN, '_')}`
  }
  if (event.startsWith('terminal-output-normalized-')) {
    const prefix = 'terminal-output-normalized-'
    return `${prefix}${event.slice(prefix.length).replace(EVENT_NAME_SAFE_PATTERN, '_')}`
  }
  return event
}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: unknown) => void) => {
    const normalized = normalizeEventName(event)
    eventHandlers[normalized] = handler
    return () => { eventHandlers[normalized] = null }
  }),
  emit: vi.fn()
}))

vi.mock('../../terminal/stream/terminalOutputManager', () => ({
  terminalOutputManager: {
    ensureStarted: vi.fn(async () => {}),
    addListener: vi.fn((id: string, listener: (chunk: string) => void) => {
      terminalOutputHarness.add(id, listener)
    }),
    removeListener: vi.fn((id: string, listener: (chunk: string) => void) => {
      terminalOutputHarness.remove(id, listener)
    }),
    dispose: vi.fn(async () => {}),
    __emit: (id: string, chunk: string) => {
      terminalOutputHarness.emit(id, chunk)
    },
  },
}))

beforeEach(() => {
  for (const key of Object.keys(eventHandlers)) {
    eventHandlers[key] = null
  }
  pluginTransportHarness.reset()
  terminalOutputHarness.reset()
})

// Stub internal Terminal component to avoid xterm heavy setup while exposing scroll spy
const terminalMocks = vi.hoisted(() => {
  const React = require('react') as typeof import('react')
  const focusMock = vi.fn()
  const showSearchMock = vi.fn()
  const scrollToBottomMock = vi.fn()
  const TerminalStub = React.forwardRef((_props: unknown, ref) => {
    React.useImperativeHandle(ref, () => ({
      focus: focusMock,
      showSearch: showSearchMock,
      scrollToBottom: scrollToBottomMock,
    }))
    return React.createElement('div', { 'data-testid': 'terminal' })
  })
  return {
    focusMock,
    showSearchMock,
    scrollToBottomMock,
    TerminalStub,
  }
})

vi.mock('./Terminal', () => ({
  Terminal: terminalMocks.TerminalStub,
}))

const { focusMock, showSearchMock, scrollToBottomMock } = terminalMocks

beforeEach(() => {
  focusMock.mockClear()
  showSearchMock.mockClear()
  scrollToBottomMock.mockClear()
})

function Wrapper({ onRunningStateChange = () => {} }: { onRunningStateChange?: (isRunning: boolean) => void }) {
  const ref = useRef<RunTerminalHandle>(null)
  return (
    <div>
      <RunTerminal ref={ref} className="h-40" sessionName="test" onRunningStateChange={onRunningStateChange} />
      <button onClick={() => ref.current?.toggleRun()}>toggle</button>
    </div>
  )
}

describe('RunTerminal', () => {
  it('cleans up TerminalClosed listener even if registration resolves after unmount', async () => {
    const { listen } = await import('@tauri-apps/api/event')
    const listenMock = vi.mocked(listen)
    let resolveRegistration: ((unlistenFn: () => void) => void) | undefined
    const unlistenSpy = vi.fn()

    listenMock.mockImplementationOnce(((event: string, handler: unknown) => {
      const normalized = normalizeEventName(event)
      eventHandlers[normalized] = handler as (payload: unknown) => void

      return new Promise<() => void>(resolve => {
        resolveRegistration = (unlistenFn: () => void) => {
          resolve(() => {
            try {
              unlistenFn()
            } finally {
              const closedEvent = normalizeEventName('schaltwerk:terminal-closed')
              eventHandlers[closedEvent] = null
              unlistenSpy()
            }
          })
        }
      })
    }) as typeof listen)

    const { unmount } = render(<Wrapper />)

    await act(async () => { await Promise.resolve() })

    unmount()

    expect(resolveRegistration).toBeDefined()
    resolveRegistration?.(() => {})

    await act(async () => { await Promise.resolve() })

    expect(unlistenSpy).toHaveBeenCalledTimes(1)
  })

  it('shows [process has ended] after TerminalClosed', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)
    
    let terminalCreated = false
    
    // Update mock to track terminal creation
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'bun run dev', environmentVariables: {} }
      }
      if (cmd === TauriCommands.TerminalExists) return terminalCreated
      if (cmd === TauriCommands.CreateRunTerminal) {
        terminalCreated = true
        return 'run-terminal-test'
      }
      if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
      return undefined
    })
    
    render(<Wrapper />)

    // Wait for component to load
    await screen.findByText('Ready to run:')
    expect(screen.getByText('bun run dev')).toBeInTheDocument()

    // Start run
    await act(async () => {
      screen.getByText('toggle').click()
    })

    // Verify terminal is now running (header should change)
    await screen.findByText('Running:')
    
    // Verify terminal component is now displayed (no longer showing placeholder)
    expect(screen.queryByText('Press ⌘E or click Run to start')).not.toBeInTheDocument()

    // Simulate backend TerminalClosed event for this run terminal
    await act(async () => {
      const handler = eventHandlers['schaltwerk:terminal-closed']
      if (!handler) throw new Error('TerminalClosed handler was not registered')
      // Call handler with the correct terminal ID format
      handler({ payload: { terminal_id: 'run-terminal-test' } })
    })

    // Wait for state update using waitFor instead of setTimeout
    await waitFor(() => {
      expect(screen.getByText('Ready to run:')).toBeInTheDocument()
    }, { timeout: 2000 })

    // Should now show "Ready to run:" again and the process ended message
    expect(screen.getByText('Ready to run:')).toBeInTheDocument()
    expect(screen.getByText('[process has ended]')).toBeInTheDocument()
  })

  it('scrolls the terminal to bottom when starting a run', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)

    let terminalCreated = false

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'bun run dev', environmentVariables: {} }
      }
      if (cmd === TauriCommands.TerminalExists) return terminalCreated
      if (cmd === TauriCommands.CreateRunTerminal) {
        terminalCreated = true
        return 'run-terminal-test'
      }
      if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
      if (cmd === TauriCommands.WriteTerminal) return undefined
      return undefined
    })

    render(<Wrapper />)

    await screen.findByText('Ready to run:')
    expect(scrollToBottomMock).not.toHaveBeenCalled()

    await act(async () => {
      screen.getByText('toggle').click()
    })

    await screen.findByText('Running:')
    expect(scrollToBottomMock).toHaveBeenCalled()
  })

  it('resets running state when run command exits naturally', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)

    let terminalCreated = false
    let lastWriteData: string | null = null

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'bun run dev', environmentVariables: {} }
      }
      if (cmd === TauriCommands.TerminalExists) return terminalCreated
      if (cmd === TauriCommands.CreateRunTerminal) {
        terminalCreated = true
        return 'run-terminal-test'
      }
      if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
      if (cmd === TauriCommands.WriteTerminal) {
        lastWriteData = (args as { data: string }).data
        return undefined
      }
      return undefined
    })

    const onRunningStateChange = vi.fn()
    render(<Wrapper onRunningStateChange={onRunningStateChange} />)

    await screen.findByText('Ready to run:')

    await act(async () => {
      screen.getByText('toggle').click()
    })

    await screen.findByText('Running:')
    expect(onRunningStateChange).toHaveBeenCalledWith(true)

    await act(async () => {
      terminalOutputHarness.emit('run-terminal-test', '__SCHALTWERK')
      terminalOutputHarness.emit('run-terminal-test', '_RUN_EXIT__=0\r')
    })

    await screen.findByText('Ready to run:')
    expect(onRunningStateChange).toHaveBeenLastCalledWith(false)
    expect(lastWriteData).toContain(RUN_EXIT_PRINTF_PATTERN)
  })

  it('resets running state when plugin transport delivers exit sentinel', async () => {
    pluginTransportHarness.setEnabled(true)

    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)

    let terminalCreated = false

    mockInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'bun run dev', environmentVariables: {} }
      }
      if (cmd === TauriCommands.TerminalExists) return terminalCreated
      if (cmd === TauriCommands.CreateRunTerminal) {
        terminalCreated = true
        return 'run-terminal-test'
      }
      if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
      if (cmd === TauriCommands.WriteTerminal) {
        return undefined
      }
      return undefined
    })

    const onRunningStateChange = vi.fn()
    render(<Wrapper onRunningStateChange={onRunningStateChange} />)

    await screen.findByText('Ready to run:')

    await act(async () => {
      screen.getByText('toggle').click()
    })

    await screen.findByText('Running:')

    await act(async () => {
      terminalOutputHarness.emit('run-terminal-test', '__SCHALTWERK_RUN_EXIT__=0\r')
    })

    await screen.findByText('Ready to run:')
    expect(onRunningStateChange).toHaveBeenLastCalledWith(false)
  })
})
