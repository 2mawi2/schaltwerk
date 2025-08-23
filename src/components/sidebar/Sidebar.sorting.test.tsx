import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { invoke } from '@tauri-apps/api/core'
import { FilterMode, SortMode } from '../../types/sessionFilters'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

// Mock the useProject hook to always return a project path
vi.mock('../../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>('../../contexts/ProjectContext')
  return {
    ...actual,
    useProject: () => ({
      projectPath: '/test/project',
      setProjectPath: vi.fn()
    })
  }
})

interface SessionInfo {
  session_id: string
  display_name?: string
  branch: string
  worktree_path: string
  base_branch: string
  merge_mode: string
  status: 'active' | 'dirty' | 'missing' | 'archived'
  created_at?: string
  last_modified?: string
  has_uncommitted_changes?: boolean
  is_current: boolean
  session_type: 'worktree' | 'container'
  container_status?: string
  current_task?: string
  todo_percentage?: number
  is_blocked?: boolean
  diff_stats?: {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
  }
  ready_to_merge?: boolean
}

interface EnrichedSession {
  info: SessionInfo
  status?: any
  terminals: string[]
}

const createSession = (id: string, lastModified?: string, createdAt?: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    merge_mode: 'rebase',
    status: 'active',
    created_at: createdAt,
    last_modified: lastModified,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge
  },
  terminals: []
})

describe('Sidebar sorting functionality', () => {
  let savedFilterMode: string = FilterMode.All
  let savedSortMode: string = SortMode.Name
  
  // Helper function to wrap component with all required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <ProjectProvider>
        <FontSizeProvider>
          <SessionsProvider>
            <SelectionProvider>
              <FocusProvider>
                {component}
              </FocusProvider>
            </SelectionProvider>
          </SessionsProvider>
        </FontSizeProvider>
      </ProjectProvider>
    )
  }
  
  beforeEach(() => {
    vi.clearAllMocks()
    savedFilterMode = FilterMode.All
    savedSortMode = SortMode.Name
  })
  
  const createInvokeMock = (sessions: any[]) => {
    return async (cmd: string, args?: any) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'para_core_list_sessions_by_state') return []
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: savedFilterMode, sort_mode: savedSortMode }
      }
      if (cmd === 'set_project_sessions_settings') {
        savedFilterMode = args?.filterMode || FilterMode.All
        savedSortMode = args?.sortMode || SortMode.Name
        return undefined
      }
      return undefined
    }
  }

  it('should cycle through sort modes: name -> created -> last-edited -> name', async () => {
    const sessions = [
      createSession('alpha_session', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z'), // Created Jan 1, edited Jan 15
      createSession('zebra_session', '2024-01-10T10:00:00Z', '2024-01-02T10:00:00Z'), // Created Jan 2, edited Jan 10
      createSession('beta_session', '2024-01-20T10:00:00Z', '2023-12-31T10:00:00Z'),  // Created Dec 31, edited Jan 20
    ]

    vi.mocked(invoke).mockImplementation(createInvokeMock(sessions))

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('para/')
      )
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Initial state: sorted by name (alphabetical)
    // Find session buttons by their distinct structure (have both session name and branch)
    let sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })
    expect(sessionButtons).toHaveLength(3)
    expect(sessionButtons[0]).toHaveTextContent('alpha_session')
    expect(sessionButtons[1]).toHaveTextContent('beta_session')
    expect(sessionButtons[2]).toHaveTextContent('zebra_session')

    // Click to switch to 'created' mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })
    
    sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })
    // Sorted by creation time (newest first)
    expect(sessionButtons[0]).toHaveTextContent('zebra_session') // Jan 2 (newest)
    expect(sessionButtons[1]).toHaveTextContent('alpha_session') // Jan 1
    expect(sessionButtons[2]).toHaveTextContent('beta_session')  // Dec 31 (oldest)

    // Click to switch to 'last-edited' mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
    
    sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })
    // Sorted by last modified (most recent first)
    expect(sessionButtons[0]).toHaveTextContent('beta_session')  // Jan 20
    expect(sessionButtons[1]).toHaveTextContent('alpha_session') // Jan 15
    expect(sessionButtons[2]).toHaveTextContent('zebra_session') // Jan 10

    // Click to cycle back to 'name' mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
    })
    
    sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })
    // Back to alphabetical
    expect(sessionButtons[0]).toHaveTextContent('alpha_session')
    expect(sessionButtons[1]).toHaveTextContent('beta_session')
    expect(sessionButtons[2]).toHaveTextContent('zebra_session')
  })

  it('should keep reviewed sessions at the bottom regardless of sort mode', async () => {
    const sessions = [
      createSession('alpha_session', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z', false),
      createSession('zebra_session', '2024-01-10T10:00:00Z', '2024-01-02T10:00:00Z', true), // reviewed
      createSession('beta_session', '2024-01-20T10:00:00Z', '2024-01-03T10:00:00Z', false),
      createSession('gamma_session', '2024-01-05T10:00:00Z', '2024-01-04T10:00:00Z', true), // reviewed
    ]

    vi.mocked(invoke).mockImplementation(createInvokeMock(sessions))

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('para/')
      )
      expect(sessionButtons).toHaveLength(4)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Name mode: unreviewed (alphabetical), then reviewed (alphabetical)
    let sessionButtons = screen.getAllByRole('button').filter(btn => 
      btn.textContent?.includes('para/')
    )
    expect(sessionButtons[0]).toHaveTextContent('alpha_session') // unreviewed
    expect(sessionButtons[1]).toHaveTextContent('beta_session')  // unreviewed
    expect(sessionButtons[2]).toHaveTextContent('gamma_session') // reviewed
    expect(sessionButtons[3]).toHaveTextContent('zebra_session') // reviewed

    // Switch to last-edited mode
    fireEvent.click(sortButton) // to created
    fireEvent.click(sortButton) // to last-edited
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
    
    sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })
    // Unreviewed by last-edited, then reviewed alphabetically
    expect(sessionButtons[0]).toHaveTextContent('beta')  // unreviewed, Jan 20
    expect(sessionButtons[1]).toHaveTextContent('alpha') // unreviewed, Jan 15
    expect(sessionButtons[2]).toHaveTextContent('gamma') // reviewed (alphabetical)
    expect(sessionButtons[3]).toHaveTextContent('zebra') // reviewed (alphabetical)
  })

  it('should persist sort mode preference in localStorage', async () => {
    const sessions = [createSession('test_session', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z')]

    vi.mocked(invoke).mockImplementation(createInvokeMock(sessions))

    const { unmount } = renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('para/')
      )
      expect(sessionButtons).toHaveLength(1)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Switch to created mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(savedSortMode).toBe('created')
    })

    // Switch to last-edited mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(savedSortMode).toBe('last-edited')
    })

    // Unmount and remount - should restore last-edited mode
    unmount()
    
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const newSortButton = screen.getByTitle(/^Sort:/i)
      expect(newSortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
  })

  it('should handle sessions without timestamps gracefully', async () => {
    const sessions = [
      createSession('no_timestamp_session', '2024-01-15T10:00:00Z'),
      createSession('alpha_1704067200_x', '2024-01-10T10:00:00Z'),
      createSession('another_no_timestamp', undefined),
    ]

    vi.mocked(invoke).mockImplementation(createInvokeMock(sessions))

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('para/')
      )
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Switch to created mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })
    
    // Sessions with timestamps come first (newest first), then sessions without timestamps (alphabetical)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') || (text.includes('_session') && !text.includes('main'))
    })
    expect(sessionButtons).toHaveLength(3)
    expect(sessionButtons[0]).toHaveTextContent('alpha') // Has timestamp (newest/only one with timestamp)
    expect(sessionButtons[1]).toHaveTextContent('another_no_timestamp') // No timestamp (alphabetical)
    expect(sessionButtons[2]).toHaveTextContent('no_timestamp_session')  // No timestamp (alphabetical)
  })
})