import { render, screen, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import userEvent from '@testing-library/user-event'
import { vi, type MockedFunction } from 'vitest'
import { createChangedFile, renderWithProviders } from '../../tests/test-utils'
import { TestProviders } from '../../tests/test-utils'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { rightPanelTabAtom } from '../../store/atoms/rightPanelTab'
import { previewStateAtom } from '../../store/atoms/preview'
import { projectPathAtom } from '../../store/atoms/project'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as MockedFunction<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
>

// Mutable selection used by mocked hook
let currentSelection: Record<string, unknown> = { kind: 'orchestrator' }
const mockSetSelection = vi.fn()
const mockTerminals = { top: 'orchestrator-top' }
const mockClearTerminalTracking = vi.fn()
vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: currentSelection,
      terminals: mockTerminals,
      isReady: true,
      isSpec: false,
      setSelection: mockSetSelection,
      clearTerminalTracking: mockClearTerminalTracking,
    })
  }
})

let mockSessions: unknown[] = []
const mockReloadSessions = vi.fn(async () => {})
vi.mock('../../hooks/useSessions', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSessions')
  return {
    ...actual,
    useSessions: () => ({
      sessions: mockSessions,
      allSessions: mockSessions,
      filteredSessions: mockSessions,
      sortedSessions: mockSessions,
      loading: false,
      reloadSessions: mockReloadSessions,
      getSessionsByState: vi.fn(() => []),
    }),
  }
})

vi.mock('./UnifiedDiffView', () => ({
  UnifiedDiffView: () => <div data-testid="mock-unified-view" />
}))

const defaultDiffPrefs = {
  continuous_scroll: false,
  compact_diffs: true,
  sidebar_width: 320,
  inline_sidebar_default: true,
}

const setupInvoke = (overrides: Record<string, (args?: Record<string, unknown>) => unknown> = {}) => {
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === TauriCommands.GetDiffViewPreferences) {
      return defaultDiffPrefs
    }
    const handler = overrides[cmd]
    if (handler) {
      return handler(args)
    }
    return null
  })
}

describe('SimpleDiffPanel', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.doUnmock('./DiffFileList')
    vi.clearAllMocks()
    invoke.mockReset()
    mockSetSelection.mockReset()
    mockClearTerminalTracking.mockReset()
    mockReloadSessions.mockReset()
    mockTerminals.top = 'orchestrator-top'
    mockSessions = []
    setupInvoke()
    // default clipboard: prefer spying if exists; else define property
    try {
      if (navigator.clipboard && 'writeText' in navigator.clipboard) {
        vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
      } else {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
          configurable: true,
          value: { writeText: vi.fn().mockResolvedValue(undefined) }
        })
      }
    } catch {
      // Fallback for environments with strict Navigator implementation
      Object.defineProperty(Object.getPrototypeOf(globalThis.navigator), 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) }
      })
    }
  })

  it('renders DiffFileList and no dock by default (orchestrator)', async () => {
    currentSelection = { kind: 'orchestrator' }
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetDiffViewPreferences) return defaultDiffPrefs
      if (cmd === TauriCommands.GetChangedFilesFromMain) return []
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(
      <TestProviders>
        <SimpleDiffPanel
          mode="list"
          onModeChange={vi.fn()}
          activeFile={null}
          onActiveFileChange={vi.fn()}
        />
      </TestProviders>
    )

    expect(await screen.findByText(/no session selected/i)).toBeInTheDocument()
    expect(screen.queryByText(/show prompt/i)).not.toBeInTheDocument()
  })

  it('does not render prompt dock in session mode anymore', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) return []
      if (cmd === TauriCommands.GetCurrentBranchName) return 'feat'
      if (cmd === TauriCommands.GetBaseBranchName) return 'main'
      if (cmd === TauriCommands.GetCommitComparisonInfo) return ['a', 'b']
      if (cmd === TauriCommands.GetDiffViewPreferences) return defaultDiffPrefs
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { original_parent_branch: 'main' }
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    render(
      <TestProviders>
        <SimpleDiffPanel
          mode="list"
          onModeChange={vi.fn()}
          activeFile={null}
          onActiveFileChange={vi.fn()}
        />
      </TestProviders>
    )

    // No prompt toggle button is present anymore
    await waitFor(() => expect(screen.queryByRole('button', { name: /show prompt/i })).not.toBeInTheDocument())
  })

  it('returns to list mode when files disappear during review', async () => {
    vi.doMock('./DiffFileList', async () => {
      const ReactModule = await import('react')
      const { useEffect } = ReactModule
      return {
        DiffFileList: ({ onFilesChange }: { onFilesChange?: (hasFiles: boolean) => void }) => {
          useEffect(() => {
            onFilesChange?.(false)
          }, [onFilesChange])
          return <div data-testid="mock-diff-list" />
        }
      }
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    const onModeChange = vi.fn()
    const onActiveFileChange = vi.fn()
    render(
      <TestProviders>
        <SimpleDiffPanel
          mode="review"
          onModeChange={onModeChange}
          activeFile="src/foo.ts"
          onActiveFileChange={onActiveFileChange}
        />
      </TestProviders>
    )

    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('list'))
    vi.doUnmock('./DiffFileList')
  })

  it('renders changed files, highlights selected row, and calls onFileSelect', async () => {
    currentSelection = { kind: 'session', payload: 's1' }

    const files = [
      createChangedFile({ path: 'src/a/file1.txt', change_type: 'modified', additions: 2, deletions: 1 }),
      createChangedFile({ path: 'src/b/file2.ts', change_type: 'added', additions: 4 }),
    ]
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) return files
      if (cmd === TauriCommands.GetCurrentBranchName) return 'feat'
      if (cmd === TauriCommands.GetBaseBranchName) return 'main'
      if (cmd === TauriCommands.GetCommitComparisonInfo) return ['a', 'b']
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { initial_prompt: '' }
      if (cmd === TauriCommands.GetDiffViewPreferences) return defaultDiffPrefs
      return null
    })

    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    const onActiveFileChange = vi.fn()
    const onModeChange = vi.fn()
    render(
      <TestProviders>
        <SimpleDiffPanel
          mode="list"
          onModeChange={onModeChange}
          activeFile={null}
          onActiveFileChange={onActiveFileChange}
        />
      </TestProviders>
    )

    expect(await screen.findByText('file1.txt')).toBeInTheDocument()
    expect(screen.getByText('file2.ts')).toBeInTheDocument()

    await user.click(screen.getByText('file1.txt'))
    expect(onActiveFileChange).toHaveBeenCalledWith('src/a/file1.txt')
    expect(onModeChange).toHaveBeenCalledWith('review')

  })

  it('renders open-in-preview button for session with linked PR', async () => {
    currentSelection = { kind: 'session', payload: 'pr-session' }
    mockSessions = [{
      info: {
        session_id: 'pr-session',
        display_name: 'PR Session',
        branch: 'feature/pr',
        worktree_path: '/tmp/pr',
        base_branch: 'main',
        status: 'active',
        is_current: true,
        session_type: 'worktree',
        session_state: 'running',
        ready_to_merge: false,
        has_uncommitted_changes: false,
        pr_number: 42,
        pr_url: 'https://github.com/org/repo/pull/42',
      },
      status: undefined,
      terminals: [],
    }]

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) return []
      if (cmd === TauriCommands.GetCurrentBranchName) return 'feature/pr'
      if (cmd === TauriCommands.GetBaseBranchName) return 'main'
      if (cmd === TauriCommands.GetCommitComparisonInfo) return []
      if (cmd === TauriCommands.GetDiffViewPreferences) return defaultDiffPrefs
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { initial_prompt: '' }
      if (cmd === TauriCommands.SchaltwerkCoreGetPrDetails) return null
      return null
    })

    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')

    const TestSetup = () => {
      const setProjectPath = useSetAtom(projectPathAtom)
      const tab = useAtomValue(rightPanelTabAtom)
      useEffect(() => { setProjectPath('/test/project') }, [setProjectPath])
      return <div data-testid="tab">{tab}</div>
    }

    renderWithProviders(
      <>
        <TestSetup />
        <SimpleDiffPanel
          mode="list"
          onModeChange={vi.fn()}
          activeFile={null}
          onActiveFileChange={vi.fn()}
        />
      </>
    )

    const previewButton = await screen.findByTitle('Open PR #42 in app preview')
    expect(previewButton).toBeInTheDocument()

    await user.click(previewButton)

    await waitFor(() => {
      expect(screen.getByTestId('tab').textContent).toBe('preview')
    })
  })
})
