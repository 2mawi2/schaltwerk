import { render, screen, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createChangedFile, TestProviders } from '../../tests/test-utils'
import { useProject } from '../../contexts/ProjectContext'
import React, { useEffect } from 'react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invoke = (await import('@tauri-apps/api/core')).invoke as ReturnType<typeof vi.fn>

const createMockSession = (sessionId: string) => ({
  info: {
    session_id: sessionId,
    branch: 'feature/test',
    base_branch: 'main',
    worktree_path: `/tmp/${sessionId}`,
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: 'running',
    ready_to_merge: false,
    diff_stats: { files_changed: 0, additions: 0, deletions: 0, insertions: 0 },
  },
  terminals: [],
})

// Mutable selection used by mocked hook
let currentSelection: Record<string, unknown> = { kind: 'orchestrator' }
vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
  return {
    ...actual,
    useSelection: () => ({ selection: currentSelection })
  }
})

function ContextInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()

  useEffect(() => {
    setProjectPath('/test/project')
  }, [setProjectPath])

  return <>{children}</>
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <TestProviders>
      <ContextInitializer>{ui}</ContextInitializer>
    </TestProviders>
  )
}

describe('SimpleDiffPanel', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockReset()
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return [createMockSession('s1')]
      }
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return null
    })
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
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return []
      }
      if (cmd === TauriCommands.GetChangedFilesFromMain) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    renderWithProviders(<SimpleDiffPanel onFileSelect={vi.fn()} />)

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
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return [createMockSession('s1')]
      return null
    })
    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    renderWithProviders(<SimpleDiffPanel onFileSelect={vi.fn()} />)

    // No prompt toggle button is present anymore
    await waitFor(() => expect(screen.queryByRole('button', { name: /show prompt/i })).not.toBeInTheDocument())

    // And we never fetch the session prompt
    const calls = invoke.mock.calls
    expect(calls.find((c: unknown[]) => (c as [string, ...unknown[]])[0] === TauriCommands.SchaltwerkCoreGetSession)).toBeUndefined()
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
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return [createMockSession('s1')]
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { initial_prompt: '' }
      return null
    })

    const { SimpleDiffPanel } = await import('./SimpleDiffPanel')
    const onFileSelect = vi.fn()
    renderWithProviders(<SimpleDiffPanel onFileSelect={onFileSelect} />)

    expect(await screen.findByText('file1.txt')).toBeInTheDocument()
    expect(screen.getByText('file2.ts')).toBeInTheDocument()

    await user.click(screen.getByText('file1.txt'))
    expect(onFileSelect).toHaveBeenCalledWith('src/a/file1.txt')

    // Selected row should have selection class
    const selected = document.querySelector('.bg-slate-800\\/30')
    expect(selected).toBeTruthy()
  })
})
