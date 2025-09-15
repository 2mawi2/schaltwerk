import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'

vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({
      selection: { kind: 'session', payload: 'demo', sessionState: 'running' },
      terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    })
  }
})
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === TauriCommands.GetChangedFilesFromMain) return []
    if (cmd === TauriCommands.GetCurrentBranchName) return 'schaltwerk/feature'
    if (cmd === TauriCommands.GetBaseBranchName) return 'main'
    if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
    if (cmd === TauriCommands.SchaltwerkCoreResetSessionWorktree) return undefined
    return null
  }),
}))

describe('UnifiedDiffModal reset button', () => {
  beforeEach(() => {
    // Set selection to a session context so the button renders
    window.dispatchEvent(new CustomEvent('schaltwerk:set-selection', { detail: { kind: 'session', payload: 'demo' } }))
  })

  it('renders reset button and triggers confirmation flow', async () => {
    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    // Wait for initial load
    await waitFor(() => expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument())

    const btn = screen.getByRole('button', { name: /reset session/i })
    expect(btn).toBeInTheDocument()

    fireEvent.click(btn)
    expect(screen.getByText(/Reset Session Worktree/i)).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: /^Reset$/ })
    fireEvent.click(confirm)

    // After invoking, dialog should eventually close
    await waitFor(() => {
      expect(screen.queryByText(/Reset Session Worktree/i)).not.toBeInTheDocument()
    })
  })
})
