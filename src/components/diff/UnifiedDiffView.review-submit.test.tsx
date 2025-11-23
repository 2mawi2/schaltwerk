import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { UnifiedDiffView } from './UnifiedDiffView'
import { TestProviders } from '../../tests/test-utils'
import { useReview } from '../../contexts/ReviewContext'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession } from '../../types/session'
import { stableSessionTerminalId } from '../../common/terminalIdentity'

const sessionName = 'test-session'
const topTerminalId = stableSessionTerminalId(sessionName, 'top')

const testSession: EnrichedSession = {
  info: {
    session_id: sessionName,
    branch: 'feature/test',
    worktree_path: '/tmp/project/.schaltwerk/worktrees/test-session',
    base_branch: 'main',
    parent_branch: null,
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    last_modified: '2024-01-01T00:00:00Z',
    is_current: true,
    session_type: 'worktree',
    session_state: 'running',
    original_agent_type: 'claude',
  },
  terminals: [],
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: [testSession],
    reloadSessions: vi.fn(),
  }),
}))

const setSelectionMock = vi.fn()

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: sessionName, sessionState: 'running' },
    terminals: { top: topTerminalId, bottomBase: 'session-test-session-bottom', workingDirectory: '/tmp/project' },
    isReady: true,
    isSpec: false,
    setSelection: setSelectionMock,
    clearTerminalTracking: vi.fn(),
  }),
}))

function SeedSessionReview() {
  const { currentReview, startReview, addComment } = useReview()
  React.useEffect(() => {
    if (!currentReview || currentReview.sessionName !== sessionName) {
      startReview(sessionName)
      return
    }
    if (currentReview.comments.length === 0) {
      addComment({
        filePath: 'src/test.ts',
        lineRange: { start: 10, end: 12 },
        side: 'new',
        selectedText: 'function example() {\n  // TODO\n}',
        comment: 'Please implement this function.',
      })
    }
  }, [currentReview, startReview, addComment])
  return null
}

describe('UnifiedDiffView review submission behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case TauriCommands.GetActiveProjectPath:
          return '/tmp/project'
        case TauriCommands.SchaltwerkCoreGetSession:
          return { worktree_path: '/tmp/project/.schaltwerk/worktrees/test-session' }
        case TauriCommands.GetSessionPreferences:
          return { always_show_large_diffs: false }
        case TauriCommands.GetChangedFilesFromMain:
          return [{ path: 'src/test.ts', change_type: 'modified', additions: 3, deletions: 0, changes: 3 }]
        case TauriCommands.ComputeUnifiedDiffBackend:
          return { lines: [], stats: { additions: 0, deletions: 0 }, fileInfo: { sizeBytes: 0 }, isLargeFile: false }
        case TauriCommands.GetCurrentBranchName:
          return 'feature/test'
        case TauriCommands.GetBaseBranchName:
          return 'main'
        case TauriCommands.GetCommitComparisonInfo:
          return ['abc1234', 'def5678']
        case TauriCommands.GetDiffViewPreferences:
          return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
        case TauriCommands.PasteAndSubmitTerminal:
          return undefined
        default:
          return null
      }
    })
  })

  it('modal mode: closes diff viewer after submitting review', async () => {
    const onCloseMock = vi.fn()

    render(
      <TestProviders>
        <SeedSessionReview />
        <UnifiedDiffModal
          filePath="src/test.ts"
          isOpen={true}
          onClose={onCloseMock}
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.queryByText(/src\/test\.ts/i)).toBeInTheDocument()
    })

    const finishButton = await screen.findByRole('button', { name: /finish review/i })
    fireEvent.click(finishButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.PasteAndSubmitTerminal,
        expect.objectContaining({
          id: topTerminalId,
        })
      )
    })

    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalled()
    })
  })

  it('sidebar mode: keeps diff viewer open after submitting review', async () => {
    const onCloseMock = vi.fn()

    render(
      <TestProviders>
        <SeedSessionReview />
        <UnifiedDiffView
          filePath="src/test.ts"
          isOpen={true}
          onClose={onCloseMock}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.queryByText(/src\/test\.ts/i)).toBeInTheDocument()
    })

    const finishButton = await screen.findByRole('button', { name: /finish review/i })
    fireEvent.click(finishButton)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        TauriCommands.PasteAndSubmitTerminal,
        expect.objectContaining({
          id: topTerminalId,
        })
      )
    })

    await waitFor(() => {
      expect(onCloseMock).not.toHaveBeenCalled()
    })

    expect(screen.queryByText(/src\/test\.ts/i)).toBeInTheDocument()
  })
})
