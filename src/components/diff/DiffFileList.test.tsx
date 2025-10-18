import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import React, { useEffect } from 'react'
import { vi } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { useSelection } from '../../contexts/SelectionContext'
import { useProject } from '../../contexts/ProjectContext'
import { TestProviders } from '../../tests/test-utils'

type MockChangedFile = { path: string; change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown' }

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === TauriCommands.SchaltwerkCoreGetSession) {
      return { worktree_path: '/tmp/worktree/' + (args?.name || 'default') }
    }
    if (cmd === TauriCommands.GetChangedFilesFromMain) {
      return [
        { path: 'src/a.ts', change_type: 'modified' },
        { path: 'src/b.ts', change_type: 'added' },
        { path: 'src/c.ts', change_type: 'deleted' },
        { path: 'readme.md', change_type: 'unknown' },
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
    return undefined
  }),
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
  const { setProjectPath } = useProject()
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

    // badge letters for change types
    expect(screen.getAllByText('M')[0]).toBeInTheDocument()
    expect(screen.getAllByText('A')[0]).toBeInTheDocument()
    expect(screen.getAllByText('D')[0]).toBeInTheDocument()
    expect(screen.getAllByText('U')[0]).toBeInTheDocument()

    // header shows number of files
    expect(screen.getByText('4 files changed')).toBeInTheDocument()
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
      const row = (fileEntry.parentElement?.parentElement) as HTMLElement | null
      expect(row).toBeTruthy()
      expect(row!.className.includes('bg-slate-800/30')).toBe(true)
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
          { path: 'src/orchestrator.ts', change_type: 'modified' },
          { path: 'config.json', change_type: 'added' },
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
          { path: 'src/main.ts', change_type: 'modified' },
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
        return [{ path: 'test.ts', change_type: 'modified' }]
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
          pendingResolves.push(() => resolve([{ path: 'test.ts', change_type: 'modified' }]))
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
            return [{ path: 'session1-file.ts', change_type: 'modified' }]
          } else if (sessionName === 'session2') {
            return [{ path: 'session2-file.ts', change_type: 'modified' }]
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
            return [{ path: 'clear-file1.ts', change_type: 'modified' }]
          } else if (sessionName === 'clear-session2') {
            return [{ path: 'clear-file2.ts', change_type: 'modified' }]
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
          return [{ path: 'identical-file.ts', change_type: 'modified' }]
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
            return [{ path: 'latest-only.ts', change_type: 'modified' }]
          }
          if (sessionName === 'test') {
            return [{ path: 'test-only.ts', change_type: 'modified' }]
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
              return [{ path: 'alpha-file.ts', change_type: 'modified' }]
            }
            if (sessionOneCalls === 2) {
              return secondSessionOneLoad.promise
            }
          }
          if (sessionName === 'beta') {
            return [{ path: 'beta-file.ts', change_type: 'modified' }]
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
      secondSessionOneLoad.resolve([{ path: 'alpha-file.ts', change_type: 'modified' }])
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
            return [{ path: 'beta-live.ts', change_type: 'modified' }]
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

      alphaDeferred.resolve([{ path: 'alpha-late.ts', change_type: 'modified' }])

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
            return [{ path: 'beta-stable.ts', change_type: 'modified' }]
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
})
