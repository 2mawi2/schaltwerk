import { render, screen, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { useRef } from 'react'
import { vi, beforeEach } from 'vitest'
import { RunTerminal, type RunTerminalHandle } from './RunTerminal'

const RUN_EXIT_PRINTF_PATTERN = '__SCHALTWERK_RUN_EXIT__='

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === TauriCommands.GetProjectRunScript) {
      return { command: 'npm run dev', environmentVariables: {} }
    }
    if (cmd === TauriCommands.TerminalExists) return false
    if (cmd === TauriCommands.CreateRunTerminal) return 'run-terminal-test'
    if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
    return undefined
  })
}))

// Mock tauri event layer so listen resolves with a controllable unlisten
const eventHandlers: Record<string, ((e: unknown) => void) | null> = {}
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: unknown) => void) => {
    eventHandlers[event] = handler
    return () => { eventHandlers[event] = null }
  }),
  emit: vi.fn()
}))

beforeEach(() => {
  for (const key of Object.keys(eventHandlers)) {
    eventHandlers[key] = null
  }
})

// Stub internal Terminal component to avoid xterm heavy setup
vi.mock('./Terminal', () => ({
  Terminal: () => <div data-testid="terminal" />, // minimal stub
}))

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
  it('shows [process has ended] after TerminalClosed', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)
    
    let terminalCreated = false
    
    // Update mock to track terminal creation
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'npm run dev', environmentVariables: {} }
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
    expect(screen.getByText('npm run dev')).toBeInTheDocument()

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

    // Wait for state update
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // Should now show "Ready to run:" again and the process ended message
    await screen.findByText('Ready to run:')
    expect(await screen.findByText('[process has ended]')).toBeInTheDocument()
  })

  it('resets running state when run command exits naturally', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = vi.mocked(invoke)

    let terminalCreated = false
    let lastWriteData: string | null = null

    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === TauriCommands.GetProjectRunScript) {
        return { command: 'npm run dev', environmentVariables: {} }
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

    const sentinelEvent = eventHandlers['terminal-output-run-terminal-test']
    expect(sentinelEvent).toBeTruthy()

    // Deliver sentinel in two chunks to verify buffer handling
    await act(async () => {
      sentinelEvent?.({ payload: '__SCHALTWERK' })
      sentinelEvent?.({ payload: '_RUN_EXIT__=0\r' })
    })

    await screen.findByText('Ready to run:')
    expect(onRunningStateChange).toHaveBeenLastCalledWith(false)
    expect(lastWriteData).toContain(RUN_EXIT_PRINTF_PATTERN)
  })
})
