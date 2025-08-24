import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  ready_to_merge?: boolean
}

interface EnrichedSession {
  info: SessionInfo
  status?: any
  terminals: string[]
}

const createSession = (id: string, readyToMerge = false, sessionState?: 'draft' | 'active'): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    merge_mode: 'rebase',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
    // Explicit session state for draft filtering in UI
    // @ts-expect-error test-only relaxed shape
    session_state: sessionState,
  },
  terminals: []
})

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ProjectProvider>
      <FontSizeProvider>
        <SessionsProvider>
          <SelectionProvider>
            <FocusProvider>
              {ui}
            </FocusProvider>
          </SelectionProvider>
        </SessionsProvider>
      </FontSizeProvider>
    </ProjectProvider>
  )
}

describe('Sidebar filter functionality and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    const sessions = [
      createSession('alpha', false, 'draft'),
      createSession('bravo', true, 'active'),  // reviewed
      createSession('charlie', false, 'draft'),
      createSession('delta', true, 'active'),  // reviewed
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
            if (cmd === 'para_core_list_enriched_sessions_sorted') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'para_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: FilterMode.All, sort_mode: SortMode.Name }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters sessions: All -> Drafts -> Reviewed', async () => {
    renderWithProviders(<Sidebar />)

    // Wait for sessions to render
    await waitFor(() => {
      const buttons = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(buttons).toHaveLength(4)
    })

    // Click Drafts
    fireEvent.click(screen.getByTitle('Show draft tasks'))

    await waitFor(() => {
      const drafts = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      // Only alpha and charlie remain (they are not ready_to_merge and not active)
      expect(drafts).toHaveLength(2)
      expect(drafts[0]).toHaveTextContent('alpha')
      expect(drafts[1]).toHaveTextContent('charlie')
    })

    // Click Reviewed
    fireEvent.click(screen.getByTitle('Show reviewed tasks'))

    await waitFor(() => {
      const reviewed = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      // Only bravo and delta
      expect(reviewed).toHaveLength(2)
      // Alphabetical within reviewed
      expect(reviewed[0]).toHaveTextContent('bravo')
      expect(reviewed[1]).toHaveTextContent('delta')
    })

    // Back to All
    const allButton = screen.getAllByRole('button').find(b => b.textContent?.startsWith('All'))
    fireEvent.click(allButton!)

    await waitFor(() => {
      const all = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(all).toHaveLength(4)
    })
  })

  it('persists filterMode to backend and restores it', async () => {
    // Mock backend settings storage
    let savedFilterMode = 'all'
    let savedSortMode = 'name'
    let settingsLoadCalled = false
    
    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      if (command === 'get_project_sessions_settings') {
        settingsLoadCalled = true
        return { filter_mode: savedFilterMode, sort_mode: savedSortMode }
      }
      if (command === 'set_project_sessions_settings') {
        // Only save if settings have been loaded (mimics the component behavior)
        if (settingsLoadCalled) {
          savedFilterMode = args?.filterMode || 'all'
          savedSortMode = args?.sortMode || 'name'
        }
        return undefined
      }
      if (command === 'para_core_list_enriched_sessions') {
        return [
          createSession('session1'),
          createSession('session2'),
          createSession('session3', true),
          createSession('session4', true),
        ]
      }
      if (command === 'get_current_directory') return '/test/dir'
      if (command === 'terminal_exists') return false
      if (command === 'create_terminal') return true
      if (command === 'get_buffer') return ''
      if (command === 'para_core_list_sessions_by_state') return []
      return undefined
    })
    
    // First render: set to Reviewed
    const { unmount } = renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const all = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(all).toHaveLength(4)
    })

    fireEvent.click(screen.getByTitle('Show reviewed tasks'))

    await waitFor(() => {
      expect(savedFilterMode).toBe('reviewed')
    })

    unmount()

    // Second render should restore 'reviewed'
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      // Only reviewed sessions should be visible on load
      const reviewed = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(reviewed).toHaveLength(2)
      const sortBtn = screen.getByTitle(/^Sort:/i)
      expect(sortBtn).toBeInTheDocument() // sanity
    })
  })
})
