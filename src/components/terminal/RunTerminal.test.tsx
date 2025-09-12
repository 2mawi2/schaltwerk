import { render, screen, act } from '@testing-library/react'
import { useRef } from 'react'
import { vi } from 'vitest'
import { RunTerminal, type RunTerminalHandle } from './RunTerminal'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === 'get_project_run_script') {
      return { command: 'npm run dev', environmentVariables: {} }
    }
    if (cmd === 'terminal_exists') return false
    if (cmd === 'create_run_terminal') return 'run-terminal-test'
    if (cmd === 'get_current_directory') return '/tmp'
    return undefined
  })
}))

// Mock tauri event layer so listen resolves with a controllable unlisten
let terminalClosedHandler: ((e: any) => void) | null = null
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (e: any) => void) => {
    // Capture TerminalClosed handler
    // Our wrapper passes the enum value directly as event string
    terminalClosedHandler = handler
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
      terminalClosedHandler?.({ payload: { terminal_id: 'run-terminal-test' } })
    })

    // Should now show "Ready to run:" again and the process ended message
    await screen.findByText('Ready to run:')
    expect(await screen.findByText('[process has ended]')).toBeInTheDocument()
  })
})
