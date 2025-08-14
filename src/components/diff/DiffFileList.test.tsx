import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { DiffFileList } from './DiffFileList'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { ProjectProvider, useProject } from '../../contexts/ProjectContext'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    if (cmd === 'para_core_get_session') {
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
    return undefined
  }),
}))

// Component to set project path for tests
function TestProjectInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  
  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
  }, [setProjectPath])
  
  return <>{children}</>
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <TestProjectInitializer>
        <SelectionProvider>{children}</SelectionProvider>
      </TestProjectInitializer>
    </ProjectProvider>
  )
}

function setSessionInStorage(sessionName: string) {
  localStorage.setItem(
    'schaltwerk-selection',
    JSON.stringify({ kind: 'session', sessionName })
  )
}

describe('DiffFileList', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders file list with mock data', async () => {
    setSessionInStorage('demo')
    render(
      <Wrapper>
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
    setSessionInStorage('demo')
    const onFileSelect = vi.fn()
    render(
      <Wrapper>
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
    const { invoke } = (await import('@tauri-apps/api/core')) as any
    ;(invoke as any).mockImplementationOnce(async (cmd: string) => {
      if (cmd === 'para_core_get_session') return { worktree_path: '/tmp' }
      if (cmd === 'get_changed_files_from_main') return []
      return 'main'
    })
    // Subsequent calls for branch info
    ;(invoke as any).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_branch_name') return 'feature/x'
      if (cmd === 'get_base_branch_name') return 'main'
      if (cmd === 'get_commit_comparison_info') return ['abc', 'def']
      return []
    })

    setSessionInStorage('demo')
    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    expect(await screen.findByText('No changes from main')).toBeInTheDocument()
  })

  it('shows orchestrator empty state when no session selected', async () => {
    // No session set in storage -> orchestrator mode
    render(
      <Wrapper>
        <DiffFileList onFileSelect={() => {}} />
      </Wrapper>
    )

    expect(await screen.findByText('No session selected')).toBeInTheDocument()
    expect(screen.getByText('Select a session to view changes')).toBeInTheDocument()
  })
})
