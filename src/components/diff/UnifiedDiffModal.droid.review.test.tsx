import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { useReview } from '../../contexts/ReviewContext'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession } from '../../types/session'
import { stableSessionTerminalId } from '../../common/terminalIdentity'

const sessionName = 'droid-session'
const topTerminalId = stableSessionTerminalId(sessionName, 'top')

const droidSession: EnrichedSession = {
  info: {
    session_id: sessionName,
    branch: 'feature/droid',
    worktree_path: '/tmp/project/.schaltwerk/worktrees/droid-session',
    base_branch: 'main',
    parent_branch: null,
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    is_current: true,
    session_type: 'worktree',
    session_state: 'running',
    original_agent_type: 'droid',
  },
  terminals: [],
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: [droidSession],
    reloadSessions: vi.fn(),
  }),
}))

const setSelectionMock = vi.fn()

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: sessionName, sessionState: 'running' },
    terminals: { top: topTerminalId, bottomBase: 'session-droid-session-bottom', workingDirectory: '/tmp/project' },
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
        filePath: 'src/main.rs',
        lineRange: { start: 10, end: 12 },
        side: 'new',
        selectedText: 'fn example() {\n  todo!()\n}',
        comment: 'Add concrete implementation.',
      })
    }
  }, [currentReview, startReview, addComment])
  return null
}

describe('UnifiedDiffModal Droid session review submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pastes review using non-bracketed mode for Droid sessions', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.GetActiveProjectPath:
          return '/tmp/project'
        case TauriCommands.SchaltwerkCoreGetSession:
          return { worktree_path: '/tmp/project/.schaltwerk/worktrees/droid-session' }
        case TauriCommands.GetSessionPreferences:
          return { always_show_large_diffs: false }
        case TauriCommands.GetChangedFilesFromMain:
          return [{ path: 'src/main.rs', change_type: 'modified', additions: 3, deletions: 0, changes: 3 }]
        case TauriCommands.ComputeUnifiedDiffBackend:
          return { lines: [], stats: { additions: 0, deletions: 0 }, fileInfo: { sizeBytes: 0 }, isLargeFile: false }
        case TauriCommands.GetCurrentBranchName:
          return 'feature/droid'
        case TauriCommands.GetBaseBranchName:
          return 'main'
        case TauriCommands.GetCommitComparisonInfo:
          return ['abc1234', 'def5678']
        case TauriCommands.GetDiffViewPreferences:
          return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
        case TauriCommands.SetDiffViewPreferences:
          return undefined
        case TauriCommands.GetFileDiffFromMain:
          return ['fn example() {}\n', 'fn example() {}\n']
        case TauriCommands.ListAvailableOpenApps:
          return []
        case TauriCommands.GetDefaultOpenApp:
          return 'finder'
        case TauriCommands.PasteAndSubmitTerminal:
          return undefined
        default:
          return undefined
      }
    })

    render(
      <TestProviders>
        <SeedSessionReview />
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    const finishButton = await screen.findByText(/Finish Review \(1 comment\)/)
    fireEvent.click(finishButton)

    await waitFor(() => {
      const pasteCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === TauriCommands.PasteAndSubmitTerminal)
      expect(pasteCall, 'expected PasteAndSubmitTerminal to be invoked').toBeDefined()
      const [, args] = pasteCall as [string, Record<string, unknown> | undefined]
      expect(args).toMatchObject({
        id: topTerminalId,
        useBracketedPaste: false,
      })
    })
  })
})
