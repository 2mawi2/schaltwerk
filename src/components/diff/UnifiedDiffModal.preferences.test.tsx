import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'

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

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
}))

describe('UnifiedDiffModal diff viewer preferences', () => {
  beforeEach(() => {
    invokeMock.mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.GetChangedFilesFromMain:
          return []
        case TauriCommands.GetOrchestratorWorkingChanges:
          return []
        case TauriCommands.GetCurrentBranchName:
          return 'feature/test'
        case TauriCommands.GetBaseBranchName:
          return 'main'
        case TauriCommands.GetCommitComparisonInfo:
          return ['abc123', 'def456']
        case TauriCommands.GetDiffViewPreferences:
          return {
            continuous_scroll: false,
            compact_diffs: true,
            sidebar_width: 340
          }
        case TauriCommands.GetSessionPreferences:
          return { auto_commit_on_review: false, skip_confirmation_modals: false }
        case TauriCommands.ListAvailableOpenApps:
          return []
        case TauriCommands.GetDefaultOpenApp:
          return 'code'
        case TauriCommands.GetProjectSettings:
          return { project_name: 'demo', project_path: '/tmp/demo' }
        default:
          return null
      }
    })
    invokeMock.mockClear()
  })

  const renderModal = () => {
    return render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )
  }

  it('applies stored sidebar width when modal opens', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const sidebar = await screen.findByTestId('diff-sidebar')
    expect(sidebar).toHaveStyle({ width: '340px' })
    expect(screen.queryByRole('button', { name: /text selection mode/i })).not.toBeInTheDocument()
  })

  it('persists sidebar width after drag', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const handle = await screen.findByTestId('diff-resize-handle')

    fireEvent.mouseDown(handle, { clientX: 340 })
    fireEvent.mouseMove(document, { clientX: 480 })
    fireEvent.mouseUp(document)

    const sidebar = await screen.findByTestId('diff-sidebar')
    expect(sidebar).toHaveStyle({ width: '480px' })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SetDiffViewPreferences, expect.objectContaining({
        preferences: expect.objectContaining({ sidebar_width: 480 })
      }))
    })
  })

})
