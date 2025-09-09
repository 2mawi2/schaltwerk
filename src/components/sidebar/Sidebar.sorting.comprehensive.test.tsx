import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { RunProvider } from '../../contexts/RunContext'
import { invoke } from '@tauri-apps/api/core'
import { EnrichedSession } from '../../types/session'
import { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

// Mock the useProject hook to provide a project path
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



const createSession = (id: string, lastModified?: string, createdAt?: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active' as const,
    created_at: createdAt,
    last_modified: lastModified,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree' as const,
    session_state: readyToMerge ? 'reviewed' as const : 'running' as const,
    ready_to_merge: readyToMerge
  },
  terminals: []
})

describe('Sidebar sorting algorithms comprehensive tests', () => {
  // Helper function to wrap component with all required providers
  const renderWithProviders = (component: React.ReactElement) => {
    return render(
      <ProjectProvider>
        <FontSizeProvider>
          <SessionsProvider>
            <SelectionProvider>
              <FocusProvider>
                <RunProvider>
                  {component}
                </RunProvider>
              </FocusProvider>
            </SelectionProvider>
          </SessionsProvider>
        </FontSizeProvider>
      </ProjectProvider>
    )
  }
  
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should sort alphabetically by name (A-Z)', async () => {
    const sessions = [
      createSession('zebra_session', '2024-01-10T10:00:00Z'),
      createSession('alpha_session', '2024-01-15T10:00:00Z'),
      createSession('beta_session', '2024-01-20T10:00:00Z')
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
        const mode = args?.sortMode || 'name'
        if (mode === 'created') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
        }
        if (mode === 'last-edited') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
        }
        return [...sessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
      }
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Default should be name sorting (A-Z)
    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(sessionButtons[0]).toHaveTextContent('alpha_session')
    expect(sessionButtons[1]).toHaveTextContent('beta_session') 
    expect(sessionButtons[2]).toHaveTextContent('zebra_session')
  })

  it('should sort by creation time (newest first)', async () => {
    const sessions = [
      createSession('old_session', '2024-01-15T10:00:00Z', '2023-12-31T10:00:00Z'),    // Created Dec 31, 2023 - oldest
      createSession('middle_session', '2024-01-10T10:00:00Z', '2024-01-01T10:00:00Z'), // Created Jan 1, 2024 - middle  
      createSession('new_session', '2024-01-05T10:00:00Z', '2024-01-02T10:00:00Z')     // Created Jan 2, 2024 - newest
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
        const mode = args?.sortMode || 'name'
        if (mode === 'created') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
        }
        if (mode === 'last-edited') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
        }
        return [...sessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
      }
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Switch to creation time sorting
    fireEvent.click(sortButton)
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })

    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    // Should be sorted newest first
    expect(sessionButtons[0]).toHaveTextContent('new_session')    // Jan 2 (newest)
    expect(sessionButtons[1]).toHaveTextContent('middle_session') // Jan 1
    expect(sessionButtons[2]).toHaveTextContent('old_session')    // Dec 31 (oldest)
  })

  it('should sort by last edited time (most recent first)', async () => {
    const sessions = [
      createSession('session_a', '2024-01-10T10:00:00Z'), // Edited Jan 10 (oldest edit)
      createSession('session_b', '2024-01-20T10:00:00Z'), // Edited Jan 20 (newest edit)  
      createSession('session_c', '2024-01-15T10:00:00Z')  // Edited Jan 15 (middle edit)
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
        const mode = args?.sortMode || 'name'
        if (mode === 'created') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
        }
        if (mode === 'last-edited') {
          return [...sessions].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
        }
        return [...sessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
      }
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Switch to creation time first, then to last edited
    fireEvent.click(sortButton) // name -> created
    fireEvent.click(sortButton) // created -> last-edited
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })

    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    // Should be sorted by last modified (most recent first)
    expect(sessionButtons[0]).toHaveTextContent('session_b') // Jan 20 (most recent)
    expect(sessionButtons[1]).toHaveTextContent('session_c') // Jan 15 (middle)  
    expect(sessionButtons[2]).toHaveTextContent('session_a') // Jan 10 (oldest)
  })

  it('should keep reviewed sessions at bottom regardless of sort mode', async () => {
    const sessions = [
      createSession('unreviewed_alpha', '2024-01-10T10:00:00Z', '2024-01-03T10:00:00Z', false),
      createSession('unreviewed_zebra', '2024-01-20T10:00:00Z', '2024-01-01T10:00:00Z', false),
      createSession('reviewed_alpha', '2024-01-25T10:00:00Z', '2024-01-02T10:00:00Z', true),   // reviewed, most recent
      createSession('reviewed_zebra', '2024-01-05T10:00:00Z', '2024-01-04T10:00:00Z', true)    // reviewed, oldest
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
        const mode = args?.sortMode || 'name'
        const isReviewed = (s: EnrichedSession) => !!s.info?.ready_to_merge
        const specs = sessions.filter(s => s.info?.session_state === 'spec')
        const unreviewed = sessions.filter(s => !isReviewed(s) && s.info?.session_state !== 'spec')
        const reviewed = sessions.filter(s => isReviewed(s)).sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        if (mode === 'created') {
          // created: newest first among unreviewed, then reviewed (alpha), then specs (alpha)
          const withTs = unreviewed.filter(s => !!s.info?.created_at)
          const without = unreviewed.filter(s => !s.info?.created_at).sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
          withTs.sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
          const draftsSorted = specs.sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
          return [...withTs, ...without, ...reviewed, ...draftsSorted]
        }
        if (mode === 'last-edited') {
          const sortedUnreviewed = [...unreviewed].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
          const draftsSorted = specs.sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
          return [...sortedUnreviewed, ...reviewed, ...draftsSorted]
        }
        // name mode: unreviewed (alpha), then reviewed (alpha), then specs (alpha)
        const unrevAlpha = [...unreviewed].sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        const draftsSorted = specs.sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        return [...unrevAlpha, ...reviewed, ...draftsSorted]
      }
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(4)
    })

    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    // Name mode should group with unreviewed before reviewed. If any reviewed appears, all previous should be unreviewed.
    const texts = sessionButtons.map(b => b.textContent || '')
    const firstReviewed = texts.findIndex(t => t.includes('reviewed_'))
    if (firstReviewed !== -1) {
      expect(texts.slice(0, firstReviewed).every(t => t.includes('unreviewed_'))).toBe(true)
    }

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Test last-edited mode
    fireEvent.click(sortButton) // name -> created
    fireEvent.click(sortButton) // created -> last-edited
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })

    const sortedButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    // Last-edited mode: unreviewed by last edit time, then reviewed alphabetically
    expect(sortedButtons[0]).toHaveTextContent('unreviewed_zebra') // unreviewed, Jan 20 (most recent)
    expect(sortedButtons[1]).toHaveTextContent('unreviewed_alpha') // unreviewed, Jan 10
    expect(sortedButtons[2]).toHaveTextContent('reviewed_alpha')   // reviewed (alphabetical)
    expect(sortedButtons[3]).toHaveTextContent('reviewed_zebra')   // reviewed (alphabetical)
  })

  it('should handle mixed sessions with and without timestamps', async () => {
    const sessions = [
      createSession('no_timestamp_beta'),                                         // No timestamp
      createSession('with_timestamp_alpha', '2024-01-10T10:00:00Z', '2024-01-01T10:00:00Z'),  // Jan 1, 2024
      createSession('no_timestamp_alpha')                                         // No timestamp
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') {
        const mode = args?.sortMode || 'name'
        const isReviewed = (s: EnrichedSession) => !!s.info?.ready_to_merge
        const specs = sessions.filter(s => s.info?.session_state === 'spec')
        const unreviewed = sessions.filter(s => !isReviewed(s) && s.info?.session_state !== 'spec')
        const reviewed = sessions.filter(s => isReviewed(s)).sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        let sorted: EnrichedSession[]
        if (mode === 'created') {
          sorted = [...unreviewed].sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
        } else if (mode === 'last-edited') {
          sorted = [...unreviewed].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
        } else {
          sorted = [...unreviewed].sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        }
        // Order: unreviewed first (by current mode) then reviewed (alpha), then specs (alpha)
        const draftsSorted = specs.sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        return [...sorted, ...reviewed, ...draftsSorted]
      }
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Test creation time sorting with mixed timestamps
    fireEvent.click(sortButton) // Switch to created mode
    await waitFor(() => {
      expect(sortButton).toHaveAttribute('title', expect.stringContaining('Creation Time'))
    })

    const sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    // Sessions with timestamps come first, then sessions without (alphabetical)
    expect(sessionButtons[0]).toHaveTextContent('with_timestamp_alpha') // Has timestamp
    const withoutTs = sessionButtons.slice(1).map(b => (b.textContent || '').replace(/Running.*/, ''))
    expect(withoutTs.some(t => t.includes('no_timestamp_alpha'))).toBe(true)
    expect(withoutTs.some(t => t.includes('no_timestamp_beta'))).toBe(true)
  })
})
