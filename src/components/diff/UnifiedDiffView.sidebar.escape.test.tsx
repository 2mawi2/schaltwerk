import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { UnifiedDiffView } from './UnifiedDiffView'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData } from './loadDiffs'
import type { EnrichedSession } from '../../types/session'
import type { ChangedFile } from '../../common/events'
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
      terminals: { ...demoTerminals, workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
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
      createDraft: vi.fn(),
    })
  }
})

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

const sampleDiff: FileDiffData = {
  file: createChangedFile({ path: 'src/demo.ts', change_type: 'modified', additions: 1, deletions: 0 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 12, language: 'typescript' },
}

const changedFilesBySession: Record<string, ChangedFile[]> = {
  demo: [sampleDiff.file],
  alpha: [createChangedFile({ path: 'src/alpha.txt', change_type: 'modified', additions: 1 })],
  beta: [createChangedFile({ path: 'src/beta.txt', change_type: 'modified', additions: 2 })],
}

const loadFileDiffMock = vi.fn(async () => sampleDiff)

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn(),
  }
})

const baseInvoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case TauriCommands.GetChangedFilesFromMain:
    case TauriCommands.GetOrchestratorWorkingChanges: {
      const sessionName = (args as { sessionName?: string } | undefined)?.sessionName ?? 'orchestrator'
      return changedFilesBySession[sessionName] ?? changedFilesBySession.demo
    }
    case TauriCommands.GetCurrentBranchName:
      return 'schaltwerk/demo'
    case TauriCommands.GetBaseBranchName:
      return 'main'
    case TauriCommands.GetCommitComparisonInfo:
      return ['abc', 'def']
    case TauriCommands.GetDiffViewPreferences:
      return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320, inline_sidebar_default: true }
    case TauriCommands.GetSessionPreferences:
      return { always_show_large_diffs: false }
    case TauriCommands.GetProjectSettings:
      return { project_name: 'demo', project_path: '/tmp/demo' }
    case TauriCommands.GetActiveProjectPath:
      return '/tmp/demo'
    case TauriCommands.ListAvailableOpenApps:
      return []
    case TauriCommands.GetDefaultOpenApp:
      return 'code'
    case TauriCommands.SchaltwerkCoreGetSession:
      return { worktree_path: '/tmp/demo' }
    case TauriCommands.SetDiffViewPreferences:
    case TauriCommands.ClipboardWriteText:
      return undefined
    default:
      return null
  }
}

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
      ...overrides,
    },
    status: undefined,
    terminals: [
      stableSessionTerminalId('demo', 'top'),
      stableSessionTerminalId('demo', 'bottom'),
    ],
  }
}

describe('UnifiedDiffView sidebar escape handling', () => {
  beforeEach(() => {
    selectionState = { kind: 'session', payload: 'demo', sessionState: 'running' }
    sessionsState = [createSession()]
    reloadSessionsMock.mockClear()
    loadFileDiffMock.mockClear()
    invokeMock.mockImplementation(baseInvoke)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lets Escape propagate in sidebar mode when no overlay is open', async () => {
    const onClose = vi.fn()

    render(
      <TestProviders>
        <UnifiedDiffView
          filePath={sampleDiff.file.path}
          isOpen={true}
          onClose={onClose}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => expect(loadFileDiffMock).toHaveBeenCalled())

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const dispatched = window.dispatchEvent(escapeEvent)

    expect(dispatched).toBe(true)
    expect(escapeEvent.defaultPrevented).toBe(false)
    expect(escapeEvent.cancelBubble).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reloads diffs when selection switches sessions', async () => {
    selectionState = { kind: 'session', payload: 'alpha', sessionState: 'running' }
    sessionsState = [createSession({ session_id: 'alpha', worktree_path: '/tmp/alpha', branch: 'feature/alpha' })]
    invokeMock.mockClear()
    loadFileDiffMock.mockClear()

    const { rerender } = render(
      <TestProviders>
        <UnifiedDiffView
          filePath={null}
          isOpen={true}
          onClose={() => {}}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(loadFileDiffMock).toHaveBeenCalledWith(
        'alpha',
        expect.objectContaining({ path: 'src/alpha.txt' }),
        'unified'
      )
    })

    loadFileDiffMock.mockClear()
    invokeMock.mockClear()

    selectionState = { kind: 'session', payload: 'beta', sessionState: 'running' }
    sessionsState = [
      createSession({ session_id: 'alpha', worktree_path: '/tmp/alpha', branch: 'feature/alpha' }),
      createSession({ session_id: 'beta', worktree_path: '/tmp/beta', branch: 'feature/beta' })
    ]

    rerender(
      <TestProviders>
        <UnifiedDiffView
          filePath={null}
          isOpen={true}
          onClose={() => {}}
          viewMode="sidebar"
        />
      </TestProviders>
    )

    await waitFor(() => {
      expect(loadFileDiffMock).toHaveBeenCalledWith(
        'beta',
        expect.objectContaining({ path: 'src/beta.txt' }),
        'unified'
      )
    })
  })
})
