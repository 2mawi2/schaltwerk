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
import type { Event as TauriEvent } from '@tauri-apps/api/event'



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

    vi.mocked(listen).mockImplementation(async (event: string, cb: (evt: TauriEvent<unknown>) => void) => {
      // capture listeners so we can trigger
      const off = () => {}
      unlistenFns.push(off)
      const mockListen = listen as typeof listen & { __last?: Record<string, (evt: TauriEvent<unknown>) => void> }
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

  it('moves a running session into spec mode after converting', async () => {
    let currentSessionState: 'running' | 'spec' = 'running'
    let hasUncommitted = false
    let serveStaleSnapshot = false

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        const stateForResponse = serveStaleSnapshot
          ? 'running'
          : currentSessionState
        const statusForResponse = stateForResponse === 'spec' ? 'spec' : 'active'
        const response: EnrichedSession = {
          info: {
            session_id: 's1',
            branch: 'para/s1',
            worktree_path: '/p/s1',
            base_branch: 'main',
            status: statusForResponse,
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: false,
            has_uncommitted_changes: hasUncommitted,
            session_state: stateForResponse,
          },
          terminals: [],
        }

        // After serving a stale snapshot once, flip back to real state
        serveStaleSnapshot = false
        return [response]
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
        const requestedState = (args as { state: string })?.state
        if (requestedState === 'spec' && currentSessionState === 'spec' && !serveStaleSnapshot) {
          return [
            {
              id: 's1-id',
              name: 's1',
              display_name: 's1',
              version_group_id: null,
              version_number: null,
              repository_path: '/repo',
              repository_name: 'repo',
              branch: 'para/s1',
              parent_branch: 'main',
              worktree_path: '/p/s1',
              status: 'spec',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-01T00:00:00.000Z',
              last_activity: null,
              initial_prompt: null,
              ready_to_merge: false,
              original_agent_type: null,
              original_skip_permissions: null,
              pending_name_generation: false,
              was_auto_generated: false,
              spec_content: '# spec',
              session_state: 'spec',
              git_stats: undefined,
            }
          ]
        }
        return []
      }
      if (cmd === TauriCommands.SchaltwerkCoreConvertSessionToDraft) {
        currentSessionState = 'spec'
        hasUncommitted = false
        serveStaleSnapshot = true // First reload returns stale data to emulate backend cache
        return undefined
      }
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

    vi.mocked(listen).mockImplementation(async () => () => {})

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const button = screen.getAllByRole('button').find(b => /s1/.test(b.textContent || ''))
      expect(button).toBeTruthy()
    })

    const convertButton = screen.getAllByTitle('Move to spec (⌘S)')[0]
    fireEvent.click(convertButton)

    await waitFor(() => {
      expect(screen.getByText('Convert Session to Spec')).toBeInTheDocument()
    })

    const confirmButton = screen.getByRole('button', { name: /Convert to Spec/ })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      const sessionButton = screen.getAllByRole('button').find(b => /s1/.test(b.textContent || ''))
      expect(sessionButton).toBeTruthy()
      expect(sessionButton).toHaveTextContent('Spec')
    })

    // Switch to spec filter and ensure the session is listed there
    fireEvent.click(screen.getByTitle('Show spec agents'))

    await waitFor(() => {
      const specButtons = screen.getAllByRole('button').filter(b => /s1/.test(b.textContent || ''))
      expect(specButtons).toHaveLength(1)
      expect(specButtons[0]).toHaveTextContent('Spec')
    })

    // Switch to reviewed filter and ensure session is not present
    fireEvent.click(screen.getByTitle('Show reviewed agents'))

    await waitFor(() => {
      const reviewedButtons = screen.getAllByRole('button').filter(b => /s1/.test(b.textContent || ''))
      expect(reviewedButtons).toHaveLength(0)
    })
  })


})
