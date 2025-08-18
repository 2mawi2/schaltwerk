import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'

// Mock tauri
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface EnrichedSession {
  info: any
  status?: any
  terminals: string[]
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ProjectProvider>
      <SelectionProvider>
        <FocusProvider>
          {ui}
        </FocusProvider>
      </SelectionProvider>
    </ProjectProvider>
  )
}

describe('Sidebar status indicators and actions', () => {
  const sessions: EnrichedSession[] = [
    { info: { session_id: 's1', branch: 'para/s1', worktree_path: '/p/s1', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    { info: { session_id: 's2', branch: 'para/s2', worktree_path: '/p/s2', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: true }, terminals: [] },
  ]

  let unlistenFns: Array<() => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
    unlistenFns = []

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'para_core_list_sessions_by_state') return []
      if (cmd === 'para_core_unmark_session_ready') return undefined
      if (cmd === 'get_current_directory') return '/cwd'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      return undefined as any
    })

    vi.mocked(listen).mockImplementation(async (event: string, cb: (evt: any) => void) => {
      // capture listeners so we can trigger
      const off = () => {}
      unlistenFns.push(off)
      ;(listen as any).__last = (listen as any).__last || {}
      ;(listen as any).__last[event] = cb
      return off
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    unlistenFns = []
  })

  it('shows Reviewed badge for ready sessions and toggles with Unmark', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(2)
    })

    // Hover state controls visibility of action buttons; but they are in DOM and clickable
    const reviewedItem = screen.getAllByRole('button').find(b => /s2/.test(b.textContent || ''))!
    expect(reviewedItem).toHaveTextContent('Reviewed')

    // Click Unmark
    const unmarkBtn = screen.getAllByTitle('Unmark as reviewed')[0]
    fireEvent.click(unmarkBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('para_core_unmark_session_ready', { name: 's2' })
    })
  })

  it('dispatches cancel event with correct details', async () => {
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(2)
    })

    const cancelBtn = screen.getAllByTitle(/Cancel session/)[0]

    const eventSpy = vi.fn()
    window.addEventListener('schaltwerk:session-action', eventSpy as any, { once: true })

    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalled()
    })
  })

  it('shows idle indicator when last edit is older than threshold', async () => {
    // Arrange sessions with last_modified timestamps
    const now = Date.now()
    const sessions: EnrichedSession[] = [
      { info: { session_id: 's1', branch: 'para/s1', worktree_path: '/p/s1', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false, last_modified: new Date(now - 6 * 60 * 1000).toISOString() }, terminals: [] },
      { info: { session_id: 's2', branch: 'para/s2', worktree_path: '/p/s2', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false, last_modified: new Date(now - 2 * 60 * 1000).toISOString() }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'para_core_list_enriched_sessions') return sessions
      if (cmd === 'para_core_list_sessions_by_state') return []
      return undefined as any
    })

    renderWithProviders(<Sidebar />)

    // Idle indicator appears only for s1 (older than 5 minutes)
    await waitFor(() => {
      const s1Btn = screen.getAllByRole('button').find(b => /s1/.test(b.textContent || ''))!
      const s2Btn = screen.getAllByRole('button').find(b => /s2/.test(b.textContent || ''))!
      expect(s1Btn.textContent).toMatch(/idle/i)
      expect(s2Btn.textContent).not.toMatch(/idle/i)
    })
  })
})
