import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { TerminalGrid } from './TerminalGrid'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import { useSelection } from '../../contexts/SelectionContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === TauriCommands.GetProjectActionButtons) return []
    if (cmd === TauriCommands.GetCurrentDirectory) return '/tmp'
    if (cmd === TauriCommands.TerminalExists) return false
    return undefined
  }),
}))

// Minimal mocks for heavy terminal components
vi.mock('./Terminal', () => ({
  Terminal: ({ terminalId }: { terminalId: string }) => <div data-testid={`terminal-${terminalId}`} />
}))
vi.mock('./TerminalTabs', () => ({
  TerminalTabs: ({ baseTerminalId }: { baseTerminalId: string }) => <div data-testid={`terminal-tabs-${baseTerminalId}`} />
}))
vi.mock('./RunTerminal', () => ({
  RunTerminal: ({ sessionName }: { sessionName?: string }) => <div data-testid={`run-terminal-${sessionName || 'orchestrator'}`} />
}))

function SelectionBridge() {
  const { setSelection } = useSelection()
  // Set to a running session so the reset button should render
  setSelection({ kind: 'session', payload: 'demo-session', sessionState: 'running' }, false, true)
  return null
}

describe('TerminalGrid reset button (session header)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders and triggers reset confirm flow', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockedInvoke = vi.mocked(invoke)

    render(
      <TestProviders>
        <SelectionBridge />
        <TerminalGrid />
      </TestProviders>
    )

    // Wait for header to appear (Agent — demo-session)
    await waitFor(() => expect(screen.getByText(/Agent — demo-session/)).toBeInTheDocument())

    // Click the reset button (trash icon)
    const btn = screen.getByRole('button', { name: /reset session/i })
    fireEvent.click(btn)

    // Confirm dialog should appear
    expect(screen.getByText(/Reset Session Worktree/i)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /^Reset$/ })
    fireEvent.click(confirm)

    // Verify backend command invoked
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetSessionWorktree, { sessionName: 'demo-session' })
    })
  })
})
