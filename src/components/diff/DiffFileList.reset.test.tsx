import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { TauriCommands } from '../../common/tauriCommands'
import { TestProviders } from '../../tests/test-utils'

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === TauriCommands.GetChangedFilesFromMain) return [{ path: 'test.txt', change_type: 'added' }]
  if (cmd === TauriCommands.GetCurrentBranchName) return 'schaltwerk/feature'
  if (cmd === TauriCommands.GetBaseBranchName) return 'main'
  if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
  if (cmd === TauriCommands.SchaltwerkCoreResetSessionWorktree) return undefined
  if (cmd === TauriCommands.StartFileWatcher) return undefined
  if (cmd === TauriCommands.StopFileWatcher) return undefined
  return null
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args as [string]) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {})
}))

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

describe('DiffFileList header reset button', () => {
  beforeEach(() => {
    // @ts-ignore
    global.confirm = vi.fn(() => true)
    vi.clearAllMocks()
  })

  it('renders icon button for session and triggers unified confirm flow', async () => {
    render(
      <TestProviders>
        <DiffFileList onFileSelect={() => {}} />
      </TestProviders>
    )
    const btn = await screen.findByRole('button', { name: /reset session/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    // Wait for the confirmation dialog to appear, then find the Reset button in it
    const confirmButtons = await screen.findAllByRole('button', { name: /^Reset$/ })
    // The Reset button should be the last one (in the dialog, not the header)
    const confirmButton = confirmButtons[confirmButtons.length - 1]
    fireEvent.click(confirmButton)
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetSessionWorktree, expect.any(Object))
  })
})
