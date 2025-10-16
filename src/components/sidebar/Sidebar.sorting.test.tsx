import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { FilterMode, SortMode } from '../../types/sessionFilters'
import { EnrichedSession } from '../../types/session'
import { MockTauriInvokeArgs } from '../../types/testing'

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



const createSession = (id: string, lastModified?: string, createdAt?: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `schaltwerk/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active',
    created_at: createdAt,
    last_modified: lastModified,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
    session_state: readyToMerge ? 'reviewed' : 'running'
  },
  terminals: []
})

describe('Sidebar sorting functionality', () => {
  let savedFilterMode: string = FilterMode.All
  let savedSortMode: string = SortMode.Name
  
  
  beforeEach(() => {
    vi.clearAllMocks()
    savedFilterMode = FilterMode.All
    savedSortMode = SortMode.Name
  })
  
  const createInvokeMock = (sessions: EnrichedSession[]) => {
    return async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        const mode = (args as { sortMode?: string })?.sortMode || SortMode.Name
        // Ensure reviewed sessions are placed at the end regardless of mode
        const isReviewed = (s: EnrichedSession) => !!s.info.ready_to_merge
        const specs = sessions.filter(s => s.info?.session_state === 'spec')
        const unreviewed = sessions.filter(s => !isReviewed(s) && s.info?.session_state !== 'spec')
        const reviewed = sessions.filter(s => isReviewed(s)).sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        let sorted: EnrichedSession[] = []
        if (mode === SortMode.Created) {
          sorted = [...unreviewed].sort((a, b) => {
            const aT = a.info?.created_at ? Date.parse(a.info.created_at) : 0
            const bT = b.info?.created_at ? Date.parse(b.info.created_at) : 0
            return bT - aT
          })
        } else if (mode === SortMode.LastEdited) {
          sorted = [...unreviewed].sort((a, b) => {
            const aT = a.info?.last_modified ? Date.parse(a.info.last_modified) : 0
            const bT = b.info?.last_modified ? Date.parse(b.info.last_modified) : 0
            return bT - aT
          })
        } else {
          sorted = [...unreviewed].sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        }
        const draftsSorted = specs.sort((a, b) => a.info!.session_id.localeCompare(b.info!.session_id))
        return [...sorted, ...reviewed, ...draftsSorted]
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === 'get_buffer') return ''
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: savedFilterMode, sort_mode: savedSortMode }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        const s = (args as { settings?: { filter_mode?: string; sort_mode?: string } })?.settings || {}
        savedFilterMode = s.filter_mode || FilterMode.All
        savedSortMode = s.sort_mode || SortMode.Name
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

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('schaltwerk/')
      )
      expect(sessionButtons).toHaveLength(3)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Initial state: sorted by name (alphabetical)
    // Find session buttons by their distinct structure (have both session name and branch)
    let sessionButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
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
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
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
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
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
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
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

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('schaltwerk/')
      )
      expect(sessionButtons).toHaveLength(4)
    })

    const sortButton = screen.getByTitle(/^Sort:/i)
    
    // Name mode: unreviewed (alphabetical), then reviewed (alphabetical)
    let sessionButtons = screen.getAllByRole('button').filter(btn => 
      btn.textContent?.includes('schaltwerk/')
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
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
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

    const { unmount } = render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('schaltwerk/')
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
    
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const newSortButton = screen.getByTitle(/^Sort:/i)
      expect(newSortButton).toHaveAttribute('title', expect.stringContaining('Last Edited'))
    })
  })

  it('should handle sessions without timestamps gracefully', async () => {
    const sessions = [
      createSession('alpha_1704067200_x', '2024-01-10T10:00:00Z'),
      createSession('no_timestamp_session', '2024-01-15T10:00:00Z'),
      createSession('another_no_timestamp', undefined),
    ]

    vi.mocked(invoke).mockImplementation(createInvokeMock(sessions))

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      // Check that sessions are loaded by looking for session buttons
      const sessionButtons = screen.getAllByRole('button').filter(btn => 
        btn.textContent?.includes('schaltwerk/')
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
      return text.includes('schaltwerk/') && !text.includes('main (orchestrator)')
    })
    expect(sessionButtons).toHaveLength(3)
    // First is the one with timestamp. Our mock extracts timestamp either from created_at or id suffix.
    expect(sessionButtons[0].textContent || '').toMatch(/alpha_\d+/)
    const remaining = sessionButtons.slice(1).map(b => (b.textContent || '').replace(/Running.*/, ''))
    expect(remaining.some(t => t.includes('another_no_timestamp'))).toBe(true)
    expect(remaining.some(t => t.includes('no_timestamp_session'))).toBe(true)
  })
})
