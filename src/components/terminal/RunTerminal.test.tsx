import { render, screen, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import { useRef } from 'react'
import { vi } from 'vitest'
import { RunTerminal, type RunTerminalHandle } from './RunTerminal'

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
let terminalClosedHandler: ((e: unknown) => void) | null = null
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (e: unknown) => void) => {
    // Capture TerminalClosed handler when the event is 'schaltwerk:terminal-closed' (the enum value)
    if (event === 'schaltwerk:terminal-closed') {
      terminalClosedHandler = handler
    }
    return () => { terminalClosedHandler = null }
  }),
  emit: vi.fn()
}))

// Stub internal Terminal component to avoid xterm heavy setup
vi.mock('./Terminal', () => ({
  Terminal: () => <div data-testid="terminal" />, // minimal stub
}))

function Wrapper() {
  const ref = useRef<RunTerminalHandle>(null)
  return (
    <div>
      <RunTerminal ref={ref} className="h-40" sessionName="test" isCommander={false} onRunningStateChange={() => {}} />
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
      if (terminalClosedHandler) {
        // Call handler with the correct terminal ID format
        terminalClosedHandler({ payload: { terminal_id: 'run-terminal-test' } })
      } else {
        throw new Error('TerminalClosed handler was not registered')
      }
    })

    // Wait for state update
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    // Should now show "Ready to run:" again and the process ended message
    await screen.findByText('Ready to run:')
    expect(await screen.findByText('[process has ended]')).toBeInTheDocument()
  })
})
