import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession } from '../../types/session'
import { FilterMode, SortMode } from '../../types/sessionFilters'

let selectionState: { kind: 'session' | 'orchestrator'; payload?: string; sessionState?: 'spec' | 'running' | 'reviewed' }
let sessionsState: EnrichedSession[]
const reloadSessionsMock = vi.fn(async () => {})

vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({
      selection: selectionState,
      terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false
    })
  }
})

vi.mock('../../contexts/SessionsContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/SessionsContext')>('../../contexts/SessionsContext')
  return {
    ...actual,
    useSessions: () => ({
      sessions: sessionsState,
      allSessions: sessionsState,
      filteredSessions: sessionsState,
      sortedSessions: sessionsState,
      loading: false,
      sortMode: SortMode.Name,
      filterMode: FilterMode.All,
      searchQuery: '',
      isSearchVisible: false,
      setSortMode: vi.fn(),
      setFilterMode: vi.fn(),
      setSearchQuery: vi.fn(),
      setIsSearchVisible: vi.fn(),
      setCurrentSelection: vi.fn(),
      reloadSessions: reloadSessionsMock,
      updateSessionStatus: vi.fn(),
      createDraft: vi.fn()
    })
  }
})

const baseInvoke = async (cmd: string, _args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case TauriCommands.GetChangedFilesFromMain:
    case TauriCommands.GetOrchestratorWorkingChanges:
      return []
    case TauriCommands.GetCurrentBranchName:
      return 'schaltwerk/demo'
    case TauriCommands.GetBaseBranchName:
      return 'main'
    case TauriCommands.GetCommitComparisonInfo:
      return ['abc', 'def']
    case TauriCommands.SchaltwerkCoreListEnrichedSessions:
      return []
    case TauriCommands.SchaltwerkCoreListSessionsByState:
      return []
    case TauriCommands.GetProjectSessionsSettings:
      return { filter_mode: 'all', sort_mode: 'name' }
    case TauriCommands.SetDiffViewPreferences:
    case TauriCommands.SetProjectSessionsSettings:
      return undefined
    default:
      return null
  }
}

const invokeMock = vi.fn(baseInvoke)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

describe('UnifiedDiffModal mark reviewed button', () => {
  beforeEach(() => {
    selectionState = { kind: 'session', payload: 'demo', sessionState: 'running' }
    sessionsState = [createSession()]
    reloadSessionsMock.mockClear()
    invokeMock.mockImplementation(baseInvoke)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks session as reviewed immediately when auto-commit is enabled', async () => {
    invokeMock.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetAutoCommitOnReview) return true
      if (cmd === TauriCommands.SchaltwerkCoreMarkSessionReady) return true
      return baseInvoke(cmd)
    })

    const onClose = vi.fn()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={onClose} />
      </TestProviders>
    )

    await waitFor(() => expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument())

    const markButton = await screen.findByRole('button', { name: /mark as reviewed/i })
    fireEvent.click(markButton)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, expect.objectContaining({ name: 'demo', autoCommit: true }))
    })

    await waitFor(() => expect(reloadSessionsMock).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows confirmation modal when auto-commit is disabled and closes after confirm', async () => {
    sessionsState = [createSession({ has_uncommitted_changes: true })]

    invokeMock.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetAutoCommitOnReview) return false
      if (cmd === TauriCommands.SchaltwerkCoreHasUncommittedChanges) return true
      if (cmd === TauriCommands.SchaltwerkCoreMarkSessionReady) return true
      return baseInvoke(cmd)
    })

    const onClose = vi.fn()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={onClose} />
      </TestProviders>
    )

    await waitFor(() => expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument())

    const markButton = await screen.findByRole('button', { name: /mark as reviewed/i })
    fireEvent.click(markButton)

    await waitFor(() => expect(screen.getByText(/Mark Session as Reviewed/i)).toBeInTheDocument())

    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: /Mark as Reviewed/i })
    fireEvent.click(confirm)

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, expect.objectContaining({ name: 'demo', autoCommit: true })))
    await waitFor(() => expect(reloadSessionsMock).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('does not render mark reviewed button for reviewed sessions', async () => {
    sessionsState = [createSession({ ready_to_merge: true })]

    const onClose = vi.fn()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={onClose} />
      </TestProviders>
    )

    await waitFor(() => expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /mark as reviewed/i })).toBeNull()
  })
})

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'demo',
      display_name: 'Demo Session',
      branch: 'feature/demo',
      worktree_path: '/tmp/demo',
      base_branch: 'main',
      status: 'active',
      is_current: true,
      session_type: 'worktree',
      session_state: 'running',
      ready_to_merge: false,
      has_uncommitted_changes: false,
      ...overrides
    },
    status: undefined,
    terminals: ['session-demo-top', 'session-demo-bottom']
  }
}
