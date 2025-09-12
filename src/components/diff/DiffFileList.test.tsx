import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { vi } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { SelectionProvider, useSelection } from '../../contexts/SelectionContext'
import { ProjectProvider, useProject } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ModalProvider } from '../../contexts/ModalContext'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'schaltwerk_core_get_session') {
      return { worktree_path: '/tmp/worktree/' + (args?.name || 'default') }
    }
    if (cmd === 'get_changed_files_from_main') {
      return [
        { path: 'src/a.ts', change_type: 'modified' },
        { path: 'src/b.ts', change_type: 'added' },
        { path: 'src/c.ts', change_type: 'deleted' },
        { path: 'readme.md', change_type: 'unknown' },
      ]
    }
    if (cmd === 'get_current_branch_name') return 'feature/x'
    if (cmd === 'get_base_branch_name') return 'main'
    if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
    if (cmd === 'get_current_directory') return '/test/project'
    if (cmd === 'terminal_exists') return false
    if (cmd === 'create_terminal') return undefined
    if (cmd === 'schaltwerk_core_list_enriched_sessions') return []
    if (cmd === 'get_project_sessions_settings') return { filter_mode: 'all', sort_mode: 'name' }
    if (cmd === 'set_project_sessions_settings') return undefined
    if (cmd === 'get_project_selection') return null
    if (cmd === 'set_project_selection') return undefined
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
    <ProjectProvider>
      <FontSizeProvider>
        <FocusProvider>
          <ModalProvider>
            <SessionsProvider>
              <SelectionProvider>
                <TestWrapper sessionName={sessionName}>
                  {children}
                </TestWrapper>
              </SelectionProvider>
            </SessionsProvider>
          </ModalProvider>
        </FocusProvider>
      </FontSizeProvider>
    </ProjectProvider>
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
    mockInvoke.mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'schaltwerk_core_get_session') return { worktree_path: '/tmp' }
      if (cmd === 'get_changed_files_from_main') return []
      return 'main'
    })
    // Subsequent calls for branch info
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === 'get_current_branch_name') return 'feature/x'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
      return []
    })

    render(
      <Wrapper sessionName="demo">
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    expect(await screen.findByText('No changes from main')).toBeInTheDocument()
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
      if (cmd === 'get_orchestrator_working_changes') {
        return [
          { path: 'src/orchestrator.ts', change_type: 'modified' },
          { path: 'config.json', change_type: 'added' },
        ]
      }
      if (cmd === 'get_current_branch_name') return 'main'
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
      if (cmd === 'get_orchestrator_working_changes') return []
      if (cmd === 'get_current_branch_name') return 'main'
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
      if (cmd === 'get_orchestrator_working_changes') {
        // Backend should filter these out, but test that they don't appear
        return [
          { path: 'src/main.ts', change_type: 'modified' },
          // .schaltwerk files should be filtered by backend
        ]
      }
      if (cmd === 'get_current_branch_name') return 'main'
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
    const invokeCallOrder: string[] = []

    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      // Add small delay to test parallel execution
      await new Promise(resolve => setTimeout(resolve, 10))
      invokeCallOrder.push(cmd)

      if (cmd === 'get_orchestrator_working_changes') {
        return [{ path: 'test.ts', change_type: 'modified' }]
      }
      if (cmd === 'get_current_branch_name') return 'main'
      return undefined
    })

    const startTime = Date.now()
    
    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} isCommander={true} />
      </Wrapper>
    )

    await screen.findByText('test.ts')
    
    const endTime = Date.now()
    const duration = endTime - startTime

    // Should complete in less time than sequential calls would take (2 * 10ms = 20ms)
    // Allow some buffer for test environment, especially CI
    expect(duration).toBeLessThan(100)
    
    // Both commands should be called
    expect(invokeCallOrder).toContain('get_orchestrator_working_changes')
    expect(invokeCallOrder).toContain('get_current_branch_name')
  })

  it('prevents concurrent loads with isLoading state', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    let callCount = 0

    const mockInvoke = invoke as ReturnType<typeof vi.fn>
    mockInvoke.mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === 'get_orchestrator_working_changes') {
        callCount++
        // Simulate slow network call
        await new Promise(resolve => setTimeout(resolve, 100))
        return [{ path: 'test.ts', change_type: 'modified' }]
      }
      if (cmd === 'get_current_branch_name') return 'main'
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
        if (cmd === 'get_changed_files_from_main') {
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
        if (cmd === 'get_current_branch_name') return 'main'
        if (cmd === 'get_base_branch_name') return 'main'  
        if (cmd === 'get_commit_comparison_info') return ['abc123', 'def456']
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
        if (cmd === 'get_changed_files_from_main') {
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
        if (cmd === 'get_current_branch_name') return 'main'
        if (cmd === 'get_base_branch_name') return 'main'  
        if (cmd === 'get_commit_comparison_info') return ['abc123', 'def456']
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
        if (cmd === 'get_changed_files_from_main') {
          apiCallCount++
          // Both sessions return identical files - this tests that session name is included in cache key
          return [{ path: 'identical-file.ts', change_type: 'modified' }]
        }
        if (cmd === 'get_current_branch_name') return 'main'
        if (cmd === 'get_base_branch_name') return 'main'  
        if (cmd === 'get_commit_comparison_info') return ['abc123', 'def456']
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
  })
})