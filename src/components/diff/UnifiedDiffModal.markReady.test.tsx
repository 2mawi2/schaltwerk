import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession } from '../../types/session'
import { FilterMode } from '../../types/sessionFilters'
import { sessionTerminalGroup, stableSessionTerminalId } from '../../common/terminalIdentity'

let selectionState: { kind: 'session' | 'orchestrator'; payload?: string; sessionState?: 'spec' | 'running' | 'reviewed' }
let sessionsState: EnrichedSession[]
const reloadSessionsMock = vi.fn(async () => {})
const demoTerminals = sessionTerminalGroup('demo')

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: selectionState,
      terminals: {
        top: demoTerminals.top,
        bottomBase: demoTerminals.bottomBase,
        workingDirectory: '/tmp'
      },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false
    })
  }
})

vi.mock('../../hooks/useSessions', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useSessions')>('../../hooks/useSessions')
  return {
    ...actual,
    useSessions: () => ({
      sessions: sessionsState,
      allSessions: sessionsState,
      filteredSessions: sessionsState,
      sortedSessions: sessionsState,
      loading: false,
      filterMode: FilterMode.All,
      searchQuery: '',
      isSearchVisible: false,
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
    case TauriCommands.GetDiffViewPreferences:
      return { continuous_scroll: false, compact_diffs: true }
    case TauriCommands.SchaltwerkCoreListEnrichedSessions:
      return []
    case TauriCommands.SchaltwerkCoreListSessionsByState:
      return []
    case TauriCommands.GetProjectSessionsSettings:
      return { filter_mode: 'all' }
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

  it('marks session as reviewed when the button is clicked', async () => {
    invokeMock.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
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
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreMarkSessionReady,
        expect.objectContaining({ name: 'demo', autoCommit: false })
      )
    })

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

  it('persists compact diff preference when toggled', async () => {
    const onClose = vi.fn()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={onClose} />
      </TestProviders>
    )

    await waitFor(() => expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument())

    const compactToggle = await screen.findByRole('button', { name: /show full context/i })
    fireEvent.click(compactToggle)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SetDiffViewPreferences,
        expect.objectContaining({
          preferences: expect.objectContaining({
            continuous_scroll: false,
            compact_diffs: false
          })
        })
      )
    })
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
    terminals: [
      stableSessionTerminalId('demo', 'top'),
      stableSessionTerminalId('demo', 'bottom')
    ]
  }
}
