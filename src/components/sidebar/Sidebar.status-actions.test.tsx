import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'

// Mock tauri
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

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

import { invoke } from '@tauri-apps/api/core'
import { EnrichedSession } from '../../types/session'
import { listen } from '@tauri-apps/api/event'
import type { Event } from '@tauri-apps/api/event'



describe('Sidebar status indicators and actions', () => {
  const sessions: EnrichedSession[] = [
    { info: { session_id: 's1', branch: 'para/s1', worktree_path: '/p/s1', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false, session_state: 'running' }, terminals: [] },
    { info: { session_id: 's2', branch: 'para/s2', worktree_path: '/p/s2', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: true, session_state: 'reviewed' }, terminals: [] },
  ]

  let unlistenFns: Array<() => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
    unlistenFns = []

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.SchaltwerkCoreUnmarkSessionReady) return undefined
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    vi.mocked(listen).mockImplementation(async (event: string, cb: (evt: Event<unknown>) => void) => {
      // capture listeners so we can trigger
      const off = () => {}
      unlistenFns.push(off)
      const mockListen = listen as typeof listen & { __last?: Record<string, (evt: Event<unknown>) => void> }
      mockListen.__last = mockListen.__last || {}
      mockListen.__last[event] = cb
      return off
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    unlistenFns = []
  })

  it('shows Reviewed badge for ready sessions and toggles with Unmark', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(2)
    })

    // Hover state controls visibility of action buttons; but they are in DOM and clickable
    const reviewedItem = screen.getAllByRole('button').find(b => /s2/.test(b.textContent || ''))!
    expect(reviewedItem).toHaveTextContent('Reviewed')

    // Click Unmark
    const unmarkCandidates = within(reviewedItem).getAllByTitle(/Unmark as reviewed/)
    const unmarkBtn = unmarkCandidates.find(el => (el as HTMLElement).tagName === 'BUTTON') as HTMLElement
    fireEvent.click(unmarkBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreUnmarkSessionReady, { name: 's2' })
    })
  })

  it('dispatches cancel event with correct details', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(2)
    })

    const cancelBtn = screen.getAllByTitle(/Cancel session/)[0]

    const eventSpy = vi.fn()
    window.addEventListener('schaltwerk:session-action', eventSpy as EventListener, { once: true })

    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalled()
    })
  })

  it('shows idle indicator when last edit is older than threshold', async () => {
    // Arrange sessions with last_modified timestamps
    const now = Date.now()
    const sessions: EnrichedSession[] = [
      { info: { session_id: 's1', branch: 'para/s1', worktree_path: '/p/s1', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', session_state: 'running', ready_to_merge: false, last_modified: new Date(now - 6 * 60 * 1000).toISOString(), last_modified_ts: now - 6 * 60 * 1000 }, terminals: [] },
      { info: { session_id: 's2', branch: 'para/s2', worktree_path: '/p/s2', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree', session_state: 'running', ready_to_merge: false, last_modified: new Date(now - 2 * 60 * 1000).toISOString(), last_modified_ts: now - 2 * 60 * 1000 }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    // Idle indicator appears only for s1 (older than 5 minutes)
    await waitFor(() => {
      const s1Btn = screen.getAllByRole('button').find(b => /s1/.test(b.textContent || ''))!
      const s2Btn = screen.getAllByRole('button').find(b => /s2/.test(b.textContent || ''))!
      expect(s1Btn.textContent).toMatch(/idle/i)
      expect(s2Btn.textContent).not.toMatch(/idle/i)
    })
  })
})
