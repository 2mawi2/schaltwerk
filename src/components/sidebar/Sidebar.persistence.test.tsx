import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { invoke } from '@tauri-apps/api/core'

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

describe('Sidebar sort mode persistence', () => {
  let savedFilterMode = 'all'
  let savedSortMode = 'name'

  // Helper function to wrap component with all required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <ProjectProvider>
        <SelectionProvider>
          <FocusProvider>
            {component}
          </FocusProvider>
        </SelectionProvider>
      </ProjectProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset backend settings
    savedFilterMode = 'all'
    savedSortMode = 'name'

    const sessions = [
      createSession('test_session_a', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z'),
      createSession('test_session_b', '2024-01-10T10:00:00Z', '2024-01-02T10:00:00Z'),
      createSession('test_session_c', '2024-01-20T10:00:00Z', '2023-12-31T10:00:00Z')
    ]

    vi.mocked(invoke).mockImplementation(async (cmd, args?: any) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'para_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: savedFilterMode, sort_mode: savedSortMode }
      }
      if (cmd === 'set_project_sessions_settings') {
        savedFilterMode = args?.filterMode || 'all'
        savedSortMode = args?.sortMode || 'name'
        return undefined
      }
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should default to name sorting when no backend value exists', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in name (alphabetical) order by default
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Check that initial state is saved to backend
    await waitFor(() => {
      expect(savedSortMode).toBe('name')
    })
  })

  it('should restore sort mode from backend on component mount', async () => {
    // Pre-populate backend with 'created' mode
    savedSortMode = 'created'

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in creation time order (newest first)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_b') // Jan 2 (newest)
    expect(sessionButtons[1]).toHaveTextContent('test_session_a') // Jan 1  
    expect(sessionButtons[2]).toHaveTextContent('test_session_c') // Dec 31 (oldest)

    // Verify the sort button shows the correct mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
  })

  it('should persist sort mode changes to backend', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)

    // Change to created mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })
    await waitFor(() => {
      expect(savedSortMode).toBe('created')
    })

    // Change to last-edited mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
    await waitFor(() => {
      expect(savedSortMode).toBe('last-edited')
    })

    // Change back to name mode
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
    })
    await waitFor(() => {
      expect(savedSortMode).toBe('name')
    })
  })

  it('should handle backend initialization errors gracefully', async () => {
    // Test that invalid backend values are handled gracefully
    savedSortMode = 'invalid-sort-mode' as any

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should fallback to default 'name' mode when value is invalid
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b') 
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Sort button should show default name mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should handle backend errors gracefully during saving', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Make backend save throw an error
    const sessions = [
      createSession('test_session_a', '2024-01-15T10:00:00Z', '2024-01-01T10:00:00Z'),
      createSession('test_session_b', '2024-01-10T10:00:00Z', '2024-01-02T10:00:00Z'),
      createSession('test_session_c', '2024-01-20T10:00:00Z', '2023-12-31T10:00:00Z')
    ]
    
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'set_project_sessions_settings') {
        throw new Error('Backend save failed')
      }
      // Default handling for other commands
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: savedFilterMode, sort_mode: savedSortMode }
      }
      return undefined
    })

    const sortButton = screen.getByTitle(/^Sort:/i)

    // Try to change sort mode
    fireEvent.click(sortButton)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save sessions settings:',
        expect.any(Error)
      )
    })

    // Component should still work despite localStorage error
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    
    consoleSpy.mockRestore()
  })

  it('should ignore invalid backend values and use default', async () => {
    // Pre-populate backend with invalid value
    savedSortMode = 'invalid-mode' as any

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should fallback to default name sorting
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should persist sort mode across component remounts', async () => {
    // First render - change to 'last-edited' mode
    const { unmount } = renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    let sortButton = screen.getByTitle(/^Sort:/i)
    
    // Change to 'created' then 'last-edited' mode
    fireEvent.click(sortButton) // name -> created
    fireEvent.click(sortButton) // created -> last-edited
    
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })

    // Verify backend was updated
    expect(savedSortMode).toBe('last-edited')

    // Unmount component
    unmount()

    // Remount component - should restore last-edited mode
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should be in last-edited order (most recent first)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_c') // Jan 20 (most recent)
    expect(sessionButtons[1]).toHaveTextContent('test_session_a') // Jan 15
    expect(sessionButtons[2]).toHaveTextContent('test_session_b') // Jan 10 (oldest edit)

    // Verify sort button shows correct mode
    sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
  })

  it('should handle default fallback correctly', async () => {
    // Start with default backend values
    savedFilterMode = 'all'
    savedSortMode = 'name'

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Should default to name sorting when no value exists
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('test_session_a')
    expect(sessionButtons[1]).toHaveTextContent('test_session_b')
    expect(sessionButtons[2]).toHaveTextContent('test_session_c')

    // Sort button should show name mode
    const sortButton = screen.getByTitle(/^Sort:/i)
    expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
  })

  it('should validate sort mode persistence for each mode', async () => {
    const modes = ['name', 'created', 'last-edited'] as const
    
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i]
      // Set up backend with the mode
      savedSortMode = mode

      const { unmount } = renderWithProviders(<Sidebar />)

      await waitFor(() => {
        const sessionButtons = screen.getAllByRole('button').filter(btn => {
          const text = btn.textContent || ''
          return text.includes('para/') && !text.includes('main (orchestrator)')
        })
        expect(sessionButtons).toHaveLength(3)
      })

      const sortButton = screen.getByTitle(/^Sort:/i)
      
      // Verify the correct sort mode is restored
      if (mode === 'name') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Name (A-Z)'))
      } else if (mode === 'created') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
      } else if (mode === 'last-edited') {
        expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
      }

      unmount()
      
      // Reset backend for next iteration
      if (i < modes.length - 1) {
        savedFilterMode = 'all'
        savedSortMode = 'name'
      }
    }
  })
})