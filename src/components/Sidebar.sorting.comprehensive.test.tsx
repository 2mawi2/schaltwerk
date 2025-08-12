import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

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

describe('Sidebar sorting algorithms comprehensive tests', () => {
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

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })

    render(
      <SelectionProvider>
        <FocusProvider>
          <Sidebar />
        </FocusProvider>
      </SelectionProvider>
    )

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

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })

    render(
      <SelectionProvider>
        <FocusProvider>
          <Sidebar />
        </FocusProvider>
      </SelectionProvider>
    )

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

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })

    render(
      <SelectionProvider>
        <FocusProvider>
          <Sidebar />
        </FocusProvider>
      </SelectionProvider>
    )

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
      createSession('unreviewed_zebra', '2024-01-20T10:00:00Z', '2024-01-01T10:00:00Z', false),
      createSession('reviewed_alpha', '2024-01-25T10:00:00Z', '2024-01-02T10:00:00Z', true),   // reviewed, most recent
      createSession('unreviewed_alpha', '2024-01-10T10:00:00Z', '2024-01-03T10:00:00Z', false),
      createSession('reviewed_zebra', '2024-01-05T10:00:00Z', '2024-01-04T10:00:00Z', true)    // reviewed, oldest
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })

    render(
      <SelectionProvider>
        <FocusProvider>
          <Sidebar />
        </FocusProvider>
      </SelectionProvider>
    )

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

    // Name mode: unreviewed (alphabetical), then reviewed (alphabetical)
    expect(sessionButtons[0]).toHaveTextContent('unreviewed_alpha') // unreviewed first
    expect(sessionButtons[1]).toHaveTextContent('unreviewed_zebra') // unreviewed second
    expect(sessionButtons[2]).toHaveTextContent('reviewed_alpha')   // reviewed (alphabetical)
    expect(sessionButtons[3]).toHaveTextContent('reviewed_zebra')   // reviewed (alphabetical)

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

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'get_current_directory') return '/test/dir'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'get_buffer') return ''
      throw new Error(`Unexpected command: ${cmd}`)
    })

    render(
      <SelectionProvider>
        <FocusProvider>
          <Sidebar />
        </FocusProvider>
      </SelectionProvider>
    )

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
    expect(sessionButtons[1]).toHaveTextContent('no_timestamp_alpha')   // No timestamp (alphabetical)
    expect(sessionButtons[2]).toHaveTextContent('no_timestamp_beta')    // No timestamp (alphabetical)
  })
})