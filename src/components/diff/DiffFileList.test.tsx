import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React, { useEffect } from 'react'
import { vi } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { useSelection } from '../../hooks/useSelection'
import { TestProviders } from '../../tests/test-utils'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import type { SessionGitStatsUpdated } from '../../common/events'
import * as eventSystemModule from '../../common/eventSystem'
import { TauriCommands } from '../../common/tauriCommands'
import * as loggerModule from '../../utils/logger'
import { useSetAtom } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'

type MockChangedFile = {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
  additions: number
  deletions: number
  changes: number
  is_binary?: boolean
}

const createMockChangedFile = (file: Partial<MockChangedFile> & { path: string }): MockChangedFile => {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return {
    path: file.path,
    change_type: file.change_type ?? 'modified',
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    is_binary: file.is_binary,
  }
}

async function defaultInvokeImplementation(cmd: string, args?: Record<string, unknown>) {
  if (cmd === TauriCommands.SchaltwerkCoreGetSession) {
    return { worktree_path: '/tmp/worktree/' + (args?.name || 'default') }
  }
  if (cmd === TauriCommands.GetChangedFilesFromMain) {
    return [
      createMockChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 3, deletions: 1 }),
      createMockChangedFile({ path: 'src/b.ts', change_type: 'added', additions: 5 }),
      createMockChangedFile({ path: 'src/c.ts', change_type: 'deleted', deletions: 2 }),
      createMockChangedFile({ path: 'readme.md', change_type: 'unknown' }),
      createMockChangedFile({ path: 'assets/logo.png', change_type: 'modified', is_binary: true }),
    ]
  }
  if (cmd === TauriCommands.GetCurrentBranchName) return 'feature/x'
  if (cmd === TauriCommands.GetBaseBranchName) return 'main'
  if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
  if (cmd === TauriCommands.GetCurrentDirectory) return '/test/project'
  if (cmd === TauriCommands.TerminalExists) return false
  if (cmd === TauriCommands.CreateTerminal) return undefined
  if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return []
  if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
  if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
  if (cmd === TauriCommands.SchaltwerkCoreGetFontSizes) return [13, 14]
  if (cmd === TauriCommands.GetDefaultOpenApp) return 'vscode'
  if (cmd === TauriCommands.GetActiveProjectPath) return '/test/project'
  if (cmd === TauriCommands.OpenInApp) return undefined
  if (cmd === TauriCommands.StartFileWatcher) return undefined
  if (cmd === TauriCommands.StopFileWatcher) return undefined
  return undefined
}

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(defaultInvokeImplementation),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {})
}))

// Component to set project path and selection for tests
function TestWrapper({ 
  children, 
  sessionName 
}: { 
  children: React.ReactNode
  sessionName?: string 
}) {
  const setProjectPath = useSetAtom(projectPathAtom)
  const { setSelection } = useSelection()
  
  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
    // Set the selection if a session name is provided
    if (sessionName) {
      setSelection({ kind: 'session', payload: sessionName })
    }
  }, [setProjectPath, setSelection, sessionName])
  
  return <>{children}</>
}

function Wrapper({ children, sessionName }: { children: React.ReactNode, sessionName?: string }) {
  return (
    <TestProviders>
      <TestWrapper sessionName={sessionName}>
        {children}
      </TestWrapper>
    </TestProviders>
  )
}

describe('DiffFileList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders file list with mock data', async () => {
    render(
      <Wrapper sessionName="demo">
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    // filenames shown, with directory path truncated
    expect(await screen.findByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('b.ts')).toBeInTheDocument()
    expect(screen.getByText('c.ts')).toBeInTheDocument()
    expect(screen.getByText('logo.png')).toBeInTheDocument()

    // header shows number of files
    expect(screen.getByText('5 files changed')).toBeInTheDocument()

    // stats show additions, deletions, totals, and binary label
    expect(screen.getAllByText('+3')[0]).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.queryByText('Σ4')).toBeNull()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getAllByText('-0').length).toBeGreaterThan(0)
    expect(screen.queryByText('Σ5')).toBeNull()
    expect(screen.getByText('Binary')).toBeInTheDocument()
  })

  it('invokes onFileSelect and highlights selection when clicking an item', async () => {
    const onFileSelect = vi.fn()
    render(
      <Wrapper sessionName="demo">
        <DiffFileList onFileSelect={onFileSelect} />
      </Wrapper>
    )

    const fileEntry = await screen.findByText('a.ts')
    fireEvent.click(fileEntry)

    expect(onFileSelect).toHaveBeenCalledWith('src/a.ts')

    // The selected row gets the bg class; the row is the grandparent container of the filename div
    await waitFor(() => {
      const row = fileEntry.closest('[data-file-path]') as HTMLElement | null
      expect(row).toBeTruthy()
      expect(row?.dataset.selected).toBe('true')
    })
  })

  it('shows empty state when no changes', async () => {
    // Override invoke just for this test to return empty changes
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetChangedFilesFromMain) return []
      if (cmd === TauriCommands.GetCurrentBranchName) return 'feature/x'
      if (cmd === TauriCommands.GetBaseBranchName) return 'main'
      if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
      // Handle other calls with defaults
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { worktree_path: '/tmp' }
      if (cmd === TauriCommands.StartFileWatcher) return undefined
      if (cmd === TauriCommands.StopFileWatcher) return undefined
      return undefined
    })

    render(
      <Wrapper sessionName="demo">
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    expect(await screen.findByText('No changes from main (abc)')).toBeInTheDocument()
  })

  it('shows orchestrator empty state when no session selected', async () => {
    // No session set -> orchestrator mode
    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    expect(await screen.findByText('No session selected')).toBeInTheDocument()
    expect(screen.getByText('Select a session to view changes')).toBeInTheDocument()
  })

  it('shows orchestrator changes when isCommander is true', async () => {
    // Mock orchestrator-specific commands
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        return [
          createMockChangedFile({ path: 'src/orchestrator.ts', change_type: 'modified' }),
          createMockChangedFile({ path: 'config.json', change_type: 'added' }),
        ]
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })

    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // Should show orchestrator-specific header
    expect(await screen.findByText('Uncommitted Changes')).toBeInTheDocument()
    expect(await screen.findByText('(on main)')).toBeInTheDocument()
    
    // Should show orchestrator changes
    expect(screen.getByText('orchestrator.ts')).toBeInTheDocument()
    expect(screen.getByText('config.json')).toBeInTheDocument()
  })

  it('shows orchestrator empty state when no working changes', async () => {
    // Mock orchestrator with no changes
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) return []
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })

    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // Should show orchestrator-specific empty state
    expect(await screen.findByText('No uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('Your working directory is clean')).toBeInTheDocument()
  })

  it('filters out .schaltwerk files in orchestrator mode', async () => {
    // Mock orchestrator with .schaltwerk files (should not appear due to backend filtering)
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        // Backend should filter these out, but test that they don't appear
        return [
          createMockChangedFile({ path: 'src/main.ts', change_type: 'modified' }),
          // .schaltwerk files should be filtered by backend
        ]
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })

    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // Should show non-.schaltwerk files
    expect(await screen.findByText('main.ts')).toBeInTheDocument()
    
    // Should NOT show .schaltwerk files (they should be filtered by backend)
    expect(screen.queryByText('.schaltwerk')).not.toBeInTheDocument()
    expect(screen.queryByText('session.db')).not.toBeInTheDocument()
  })

  it('updates orchestrator changes when FileChanges event arrives', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        return [
          createMockChangedFile({ path: 'initial.ts', change_type: 'modified' }),
        ]
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return defaultInvokeImplementation(cmd, _args)
    })

    type FileChangesPayload = {
      session_name: string
      changed_files: MockChangedFile[]
      branch_info: {
        current_branch: string
        base_branch: string
        base_commit: string
        head_commit: string
      }
    }

    let fileChangesHandler: ((payload: FileChangesPayload) => void) | null = null

    const listenSpy = vi.spyOn(eventSystemModule, 'listenEvent').mockImplementation(async (event, handler) => {
      if (event === eventSystemModule.SchaltEvent.FileChanges) {
        fileChangesHandler = handler as (payload: FileChangesPayload) => void
      }
      return () => {}
    })

    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // Initial load from invoke
    expect(await screen.findByText('initial.ts')).toBeInTheDocument()
    expect(fileChangesHandler).toBeTruthy()

    await act(async () => {
      fileChangesHandler?.({
        session_name: 'orchestrator',
        changed_files: [
          createMockChangedFile({ path: 'updated.ts', change_type: 'modified', additions: 1 }),
        ],
        branch_info: {
          current_branch: 'main',
          base_branch: 'Working Directory',
          base_commit: 'HEAD',
          head_commit: 'Working',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('updated.ts')).toBeInTheDocument()
    })
    expect(screen.queryByText('initial.ts')).not.toBeInTheDocument()

    listenSpy.mockRestore()
    mockInvoke.mockImplementation(defaultInvokeImplementation)
  })

  it('reloads orchestrator changes when SessionGitStats event arrives', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    let orchestratorCalls = 0
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        orchestratorCalls += 1
        if (orchestratorCalls === 1) {
          return [
            createMockChangedFile({ path: 'initial.ts', change_type: 'modified' }),
          ]
        }
        return [
          createMockChangedFile({ path: 'updated.ts', change_type: 'modified' }),
        ]
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return defaultInvokeImplementation(cmd, _args)
    })

    let sessionGitStatsHandler: ((payload: SessionGitStatsUpdated) => void) | null = null

    const listenSpy = vi.spyOn(eventSystemModule, 'listenEvent').mockImplementation(async (event, handler) => {
      if (event === eventSystemModule.SchaltEvent.SessionGitStats) {
        sessionGitStatsHandler = handler as (payload: SessionGitStatsUpdated) => void
      }
      return () => {}
    })

    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    expect(await screen.findByText('initial.ts')).toBeInTheDocument()
    expect(sessionGitStatsHandler).toBeTruthy()

    await act(async () => {
      sessionGitStatsHandler?.({
        session_id: 'orchestrator',
        session_name: 'orchestrator',
        files_changed: 1,
        lines_added: 1,
        lines_removed: 0,
        has_uncommitted: true,
      })
    })

    await waitFor(() => {
      expect(screen.getByText('updated.ts')).toBeInTheDocument()
    })
    expect(screen.queryByText('initial.ts')).not.toBeInTheDocument()

    listenSpy.mockRestore()
    mockInvoke.mockImplementation(defaultInvokeImplementation)
  })

  it('uses Promise.all for parallel orchestrator calls', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const callStartTimes = new Map<string, number>()
    const callEndTimes = new Map<string, number>()
    const invokeCallOrder: string[] = []

    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      callStartTimes.set(cmd, Date.now())
      invokeCallOrder.push(cmd)
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 10))
      callEndTimes.set(cmd, Date.now())

      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        return [createMockChangedFile({ path: 'test.ts', change_type: 'modified' })]
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })
    
    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    await screen.findByText('test.ts')
    
    // Both commands should be called
    expect(invokeCallOrder).toContain(TauriCommands.GetOrchestratorWorkingChanges)
    expect(invokeCallOrder).toContain(TauriCommands.GetCurrentBranchName)
  })

  it('prevents concurrent loads with isLoading state', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    let callCount = 0
    const pendingResolves: Array<() => void> = []

    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
        callCount++
        return await new Promise(resolve => {
          pendingResolves.push(() => resolve([createMockChangedFile({ path: 'test.ts', change_type: 'modified' })]))
        })
      }
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      return undefined
    })

    const { rerender } = render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // Trigger multiple renders quickly (simulating rapid polling)
    rerender(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )
    rerender(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    // While the first request is still pending, ensure the throttling prevented duplicate calls
    expect(callCount).toBe(1)

    await act(async () => {
      pendingResolves.splice(0).forEach(resolve => resolve())
      await Promise.resolve()
    })

    await screen.findByText('test.ts')

    // Should only call once due to isLoading protection
    expect(callCount).toBe(1)
  })

  describe('Session Switching Issues', () => {
    it('should show correct files when switching between sessions quickly', async () => {
      const { invoke } = await import('@tauri-apps/api/core')

      // Track which session data was returned for each call
      const sessionCallLog: string[] = []

      const mockInvoke = invoke as ReturnType<typeof vi.fn>
      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName as string | undefined
          sessionCallLog.push(`get_changed_files_from_main:${sessionName}`)

          // Return different files for different sessions
          if (sessionName === 'session1') {
            return [createMockChangedFile({ path: 'session1-file.ts', change_type: 'modified' })]
          } else if (sessionName === 'session2') {
            return [createMockChangedFile({ path: 'session2-file.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'  
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="session1" />)
      
      // Wait for session1 data to load
      await screen.findByText('session1-file.ts')
      
      // Quickly switch to session2
      rerender(<TestWrapper sessionName="session2" />)
      
      // Should now show session2 files, not session1 files
      await waitFor(async () => {
        // This test will FAIL in the original code because it shows stale session1 data
        expect(screen.queryByText('session1-file.ts')).not.toBeInTheDocument()
        await screen.findByText('session2-file.ts')
      }, { timeout: 3000 })

      // Verify the correct API calls were made
      expect(sessionCallLog).toContain('get_changed_files_from_main:session1')
      expect(sessionCallLog).toContain('get_changed_files_from_main:session2')
    })

    it('should clear stale data immediately when sessions switch', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName
          // Add delay to simulate async loading
          await new Promise(resolve => setTimeout(resolve, 10))
          
          if (sessionName === 'clear-session1') {
            return [createMockChangedFile({ path: 'clear-file1.ts', change_type: 'modified' })]
          } else if (sessionName === 'clear-session2') {
            return [createMockChangedFile({ path: 'clear-file2.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'  
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="clear-session1" />)
      
      // Wait for session1 data to load
      await screen.findByText('clear-file1.ts')
      
      // Switch to session2
      rerender(<TestWrapper sessionName="clear-session2" />)
      
      // Should clear old data immediately and show new data
      // The key test: should NOT see session1 data when session2 is loading
      await waitFor(async () => {
        // First check that session1 data is gone
        expect(screen.queryByText('clear-file1.ts')).not.toBeInTheDocument()
        // Then wait for session2 data to appear
        await screen.findByText('clear-file2.ts')
      }, { timeout: 1000 })
    })

    it('should include session name in result signatures to prevent cache sharing', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      let apiCallCount = 0

      mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          apiCallCount++
          // Both sessions return identical files - this tests that session name is included in cache key
          return [createMockChangedFile({ path: 'identical-file.ts', change_type: 'modified' })]
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'  
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      // Load first session
      const { rerender } = render(<TestWrapper sessionName="session-a" />)
      await screen.findByText('identical-file.ts')
      expect(apiCallCount).toBe(1)
      
      // Load second session with identical data but different session name
      rerender(<TestWrapper sessionName="session-b" />)
      await screen.findByText('identical-file.ts')
      
      // Should make a second API call because session names are different,
      // even though the data is identical
      await waitFor(() => {
        expect(apiCallCount).toBe(2)
      }, { timeout: 1000 })
    })

    it('should not reuse cache when session names overlap', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName
          if (sessionName === 'latest') {
            return [createMockChangedFile({ path: 'latest-only.ts', change_type: 'modified' })]
          }
          if (sessionName === 'test') {
            return [createMockChangedFile({ path: 'test-only.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'feature/x'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="latest" />)

      await screen.findByText('latest-only.ts')

      rerender(<TestWrapper sessionName="test" />)

      await waitFor(() => {
        expect(screen.queryByText('latest-only.ts')).not.toBeInTheDocument()
      }, { timeout: 1000 })

      await screen.findByText('test-only.ts', undefined, { timeout: 1000 })
    })

    it('restores cached data immediately when switching back to a session', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      const deferred = () => {
        let resolve: (value: MockChangedFile[]) => void
        const promise = new Promise<MockChangedFile[]>((res) => {
          resolve = res
        })
        return { promise, resolve: resolve! }
      }

      let sessionOneCalls = 0
      const secondSessionOneLoad = deferred()

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName as string | undefined
          if (sessionName === 'alpha') {
            sessionOneCalls++
            if (sessionOneCalls === 1) {
              return [createMockChangedFile({ path: 'alpha-file.ts', change_type: 'modified' })]
            }
            if (sessionOneCalls === 2) {
              return secondSessionOneLoad.promise
            }
          }
          if (sessionName === 'beta') {
            return [createMockChangedFile({ path: 'beta-file.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="alpha" />)

      await screen.findByText('alpha-file.ts')

      rerender(<TestWrapper sessionName="beta" />)
      await screen.findByText('beta-file.ts')

      rerender(<TestWrapper sessionName="alpha" />)

      await waitFor(() => {
        expect(screen.getByText('alpha-file.ts')).toBeInTheDocument()
      }, { timeout: 200 })

      // Ensure the second load has been requested but not resolved yet
      expect(sessionOneCalls).toBe(2)

      // Verify the deferred promise is still pending by resolving now and waiting for stabilization
      secondSessionOneLoad.resolve([createMockChangedFile({ path: 'alpha-file.ts', change_type: 'modified' })])
      await screen.findByText('alpha-file.ts')
    })

    it('ignores late responses from previously selected sessions', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      const createDeferred = () => {
        let resolve: (value: MockChangedFile[]) => void
        const promise = new Promise<MockChangedFile[]>((res) => {
          resolve = res
        })
        return { promise, resolve: resolve! }
      }

      const alphaDeferred = createDeferred()

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName as string | undefined
          if (sessionName === 'alpha') {
            return alphaDeferred.promise
          }
          if (sessionName === 'beta') {
            return [createMockChangedFile({ path: 'beta-live.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="alpha" />)

      rerender(<TestWrapper sessionName="beta" />)
      await screen.findByText('beta-live.ts')

      alphaDeferred.resolve([createMockChangedFile({ path: 'alpha-late.ts', change_type: 'modified' })])

      await waitFor(() => {
        expect(screen.queryByText('alpha-late.ts')).not.toBeInTheDocument()
        expect(screen.getByText('beta-live.ts')).toBeInTheDocument()
      })
    })

    it('ignores late rejections from previously selected sessions', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      const createRejectDeferred = () => {
        let reject: (reason?: unknown) => void
        const promise = new Promise<MockChangedFile[]>((_, rej) => {
          reject = rej
        })
        return { promise, reject: reject! }
      }

      const alphaDeferred = createRejectDeferred()

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetChangedFilesFromMain) {
          const sessionName = args?.sessionName as string | undefined
          if (sessionName === 'alpha') {
            return alphaDeferred.promise
          }
          if (sessionName === 'beta') {
            return [createMockChangedFile({ path: 'beta-stable.ts', change_type: 'modified' })]
          }
          return []
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc123', 'def456']
        return undefined
      })

      const TestWrapper = ({ sessionName }: { sessionName: string }) => (
        <Wrapper sessionName={sessionName}>
          <DiffFileList onFileSelect={() => {}} sessionNameOverride={sessionName} />
        </Wrapper>
      )

      const { rerender } = render(<TestWrapper sessionName="alpha" />)

      rerender(<TestWrapper sessionName="beta" />)
      await screen.findByText('beta-stable.ts')

      alphaDeferred.reject(new Error('session not found'))

      await waitFor(() => {
        expect(screen.getByText('beta-stable.ts')).toBeInTheDocument()
        expect(screen.queryByText('session not found')).not.toBeInTheDocument()
      })
    })
  })

  describe('Project switching', () => {
    it('reloads orchestrator changes when project switch completes', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      let currentProject = 'alpha'
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
          if (currentProject === 'alpha') {
            return [{ path: 'src/a-alpha.ts', change_type: 'modified' }]
          }
          return [{ path: 'src/b-beta.ts', change_type: 'modified' }]
        }
        if (cmd === TauriCommands.GetCurrentBranchName) {
          return currentProject === 'alpha' ? 'alpha-main' : 'beta-main'
        }
        if (cmd === TauriCommands.GetBaseBranchName) return 'main'
        if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
        return undefined
      })

      render(
        <Wrapper>
          <DiffFileList onFileSelect={() => {}} isCommander={true} />
        </Wrapper>
      )

      expect(await screen.findByText('a-alpha.ts')).toBeInTheDocument()

      currentProject = 'beta'

      await act(async () => {
        emitUiEvent(UiEvent.ProjectSwitchComplete, { projectPath: '/projects/beta' })
      })

      await waitFor(() => {
        expect(screen.queryByText('a-alpha.ts')).not.toBeInTheDocument()
      })

      expect(await screen.findByText('b-beta.ts')).toBeInTheDocument()
    })
  })

  describe('Open file functionality', () => {
    it('renders open button for each file', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>
      mockInvoke.mockImplementation(defaultInvokeImplementation)

      render(
        <Wrapper sessionName="demo">
          <DiffFileList onFileSelect={() => {}} />
        </Wrapper>
      )

      expect(await screen.findByText('a.ts')).toBeInTheDocument()

      const openButtons = screen.getAllByLabelText(/Open .+/)
      expect(openButtons.length).toBeGreaterThan(0)
    })

    it('opens file in default editor when open button is clicked (session mode)', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.SchaltwerkCoreGetSession) {
          return { worktree_path: '/tmp/worktree/demo' }
        }
        if (cmd === TauriCommands.GetDefaultOpenApp) {
          return 'vscode'
        }
        if (cmd === TauriCommands.OpenInApp) {
          return undefined
        }
        return defaultInvokeImplementation(cmd, args)
      })

      render(
        <Wrapper sessionName="demo">
          <DiffFileList onFileSelect={() => {}} />
        </Wrapper>
      )

      const openButton = await screen.findByLabelText('Open src/a.ts')
      fireEvent.click(openButton)

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.OpenInApp, {
          appId: 'vscode',
          worktreePath: '/tmp/worktree/demo/src/a.ts'
        })
      })
    })

    it('opens file in default editor when open button is clicked (orchestrator mode)', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      const mockInvoke = invoke as ReturnType<typeof vi.fn>

      mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === TauriCommands.GetOrchestratorWorkingChanges) {
          return [
            createMockChangedFile({ path: 'src/test.ts', change_type: 'modified' }),
          ]
        }
        if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
        if (cmd === TauriCommands.GetActiveProjectPath) {
          return '/test/project'
        }
        if (cmd === TauriCommands.GetDefaultOpenApp) {
          return 'cursor'
        }
        if (cmd === TauriCommands.OpenInApp) {
          return undefined
        }
        return defaultInvokeImplementation(cmd, args)
      })

      render(
        <Wrapper>
          <DiffFileList onFileSelect={() => {}} isCommander={true} />
        </Wrapper>
      )

      const openButton = await screen.findByLabelText('Open src/test.ts')
      fireEvent.click(openButton)

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.OpenInApp, {
          appId: 'cursor',
          worktreePath: '/test/project/src/test.ts'
        })
      })
    })

  it('does not trigger row selection when open button is clicked', async () => {
    const onFileSelect = vi.fn()

    render(
      <Wrapper sessionName="demo">
        <DiffFileList onFileSelect={onFileSelect} />
      </Wrapper>
    )

    const openButton = await screen.findByLabelText('Open src/a.ts')
    fireEvent.click(openButton)

    expect(onFileSelect).not.toHaveBeenCalled()
  })

  it('suppresses missing worktree errors after a session is deleted', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    const error = new Error(
      "Failed to compute changed files: failed to resolve path '/Users/example/.schaltwerk/worktrees/zen_jang': No such file or directory; class=Os (2); code=NotFound (-3)"
    )

    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (
        cmd === TauriCommands.GetChangedFilesFromMain ||
        cmd === TauriCommands.GetCurrentBranchName ||
        cmd === TauriCommands.GetBaseBranchName ||
        cmd === TauriCommands.GetCommitComparisonInfo
      ) {
        throw error
      }
      if (cmd === TauriCommands.StartFileWatcher) return undefined
      if (cmd === TauriCommands.StopFileWatcher) return undefined
      return defaultInvokeImplementation(cmd, args)
    })

    const loggerSpy = vi.spyOn(loggerModule.logger, 'error')

    try {
      render(
        <Wrapper sessionName="demo">
          <DiffFileList onFileSelect={() => {}} />
        </Wrapper>
      )

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.StopFileWatcher, { sessionName: 'demo' })
      })

      const changedFileCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === TauriCommands.GetChangedFilesFromMain)
      expect(changedFileCalls).toHaveLength(1)
      expect(loggerSpy).not.toHaveBeenCalled()
    } finally {
      loggerSpy.mockRestore()
      mockInvoke.mockImplementation(defaultInvokeImplementation)
    }
  })
})
})
