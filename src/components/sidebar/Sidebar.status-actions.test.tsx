import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import * as uiEvents from '../../common/uiEvents'
import { UiEvent, type SessionActionDetail } from '../../common/uiEvents'

// Mock tauri
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

// TestProviders supplies a default project path for Sidebar
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
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.SchaltwerkCoreUnmarkSessionReady) return undefined
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
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
      expect(screen.getByTitle('Show reviewed agents')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTitle('Show reviewed agents'))

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(1)
    })

    const reviewedItem = screen.getAllByRole('button').find(b => /s2/.test(b.textContent || ''))!
    expect(reviewedItem).toHaveTextContent('Reviewed')

    // Click Unmark
    const unmarkCandidates = within(reviewedItem).getAllByRole('button', { name: /Unmark as reviewed/i })
    const unmarkBtn = unmarkCandidates.find(el => (el as HTMLElement).tagName === 'BUTTON') as HTMLElement
    fireEvent.click(unmarkBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreUnmarkSessionReady, { name: 's2' })
    })
  })

  it('clicking Refine on a spec switches to orchestrator and emits terminal insert events', async () => {
    const specSessions: EnrichedSession[] = [
      {
        info: {
          session_id: 'spec-alpha',
          display_name: 'Spec Alpha',
          branch: 'spec/alpha',
          worktree_path: '/spec-alpha',
          base_branch: 'main',
          status: 'spec',
          session_state: 'spec',
          is_current: false,
          session_type: 'worktree',
          ready_to_merge: false,
        },
        terminals: [],
      },
      {
        info: {
          session_id: 'running-beta',
          display_name: 'running-beta',
          branch: 'work/running-beta',
          worktree_path: '/work/running-beta',
          base_branch: 'main',
          status: 'active',
          session_state: 'running',
          is_current: false,
          session_type: 'worktree',
          ready_to_merge: false,
        },
        terminals: [],
      },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return specSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    const emitSpy = vi.spyOn(uiEvents, 'emitUiEvent')

    render(<TestProviders><Sidebar /></TestProviders>)

    // Switch to Spec filter to see spec sessions
    await waitFor(() => {
      expect(screen.getByTitle('Show spec agents')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTitle('Show spec agents'))

    await waitFor(() => {
      expect(screen.getByText('Spec Alpha')).toBeInTheDocument()
    })

    const specButton = screen.getByText('Spec Alpha').closest('[role="button"]') as HTMLElement | null
    expect(specButton).toBeTruthy()
    fireEvent.click(specButton!)

    await waitFor(() => {
      const selected = screen.getByText('Spec Alpha').closest('[role="button"]')
      expect(selected?.getAttribute('data-session-selected')).toBe('true')
    })

    emitSpy.mockClear()

    const refineButton = within(screen.getByText('Spec Alpha').closest('[role="button"]') as HTMLElement)
      .getByLabelText(/Refine spec/i)
    fireEvent.click(refineButton)

    await waitFor(() => {
      const selectionChange = emitSpy.mock.calls.find(
        ([event, detail]) =>
          event === uiEvents.UiEvent.SelectionChanged &&
          typeof detail === 'object' &&
          detail !== null &&
          (detail as { kind?: string }).kind === 'orchestrator',
      )
      expect(selectionChange).toBeDefined()
    })

    await waitFor(() => {
      const orchestratorBtn = screen.getByLabelText(/Select orchestrator/i)
      expect(orchestratorBtn.className).toContain('session-ring-blue')
    })

    expect(emitSpy).toHaveBeenCalledWith(uiEvents.UiEvent.OpenSpecInOrchestrator, { sessionName: 'spec-alpha' })
    expect(emitSpy).toHaveBeenCalledWith(uiEvents.UiEvent.InsertTerminalText, {
      text: 'Refine spec: Spec Alpha (spec-alpha)',
    })
  })

  it('dispatches cancel event with correct details', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const items = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
      expect(items.length).toBe(1)
    })

    const cancelBtn = screen.getByRole('button', { name: /Cancel session/i })

    const eventSpy = vi.fn()
    window.addEventListener('schaltwerk:session-action', eventSpy as EventListener, { once: true })

    fireEvent.click(cancelBtn)

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalled()
    })
  })

  it('emits delete-spec session action when clicking delete on a spec', async () => {
    const specSessions: EnrichedSession[] = [
      {
        info: {
          session_id: 'spec-1',
          display_name: 'Spec One',
          branch: 'spec/spec-1',
          worktree_path: '/spec/spec-1',
          base_branch: 'main',
          status: 'spec',
          session_state: 'spec',
          is_current: false,
          session_type: 'worktree',
          ready_to_merge: false,
        },
        terminals: [],
      },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return specSessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.PathExists) return true
      if (cmd === TauriCommands.DirectoryExists) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    vi.mocked(listen).mockResolvedValue(() => {})

    render(<TestProviders><Sidebar /></TestProviders>)

    // Switch to Spec filter to see spec sessions
    await waitFor(() => {
      expect(screen.getByTitle('Show spec agents')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTitle('Show spec agents'))

    await waitFor(() => {
      expect(screen.getByText('Spec One')).toBeInTheDocument()
    })

    const eventSpy = vi.fn()
    const listener = (event: Event) => eventSpy(event)
    window.addEventListener(String(UiEvent.SessionAction), listener)

    const specButton = screen.getByText('Spec One').closest('[role="button"]') as HTMLElement
    const deleteButton = within(specButton).getByLabelText(/Delete spec/i)
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalled()
    })

    const detail = (eventSpy.mock.calls[0][0] as CustomEvent<SessionActionDetail>).detail
    expect(detail).toMatchObject({
      action: 'delete-spec',
      sessionId: 'spec-1',
      sessionName: 'spec-1',
      sessionDisplayName: 'Spec One',
      branch: 'spec/spec-1',
    })

    window.removeEventListener(String(UiEvent.SessionAction), listener)
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
        const sessionNameForResponse = stateForResponse === 'spec' ? 's1-spec' : 's1'
        const response: EnrichedSession = {
          info: {
            session_id: sessionNameForResponse,
            display_name: sessionNameForResponse,
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
              name: 's1-spec',
              display_name: 's1-spec',
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
        serveStaleSnapshot = false
        return 's1-spec'
      }
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'running', sort_mode: 'name' }
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

    const convertButton = screen.getAllByRole('button', { name: /Move to spec/i })[0]
    fireEvent.click(convertButton)

    await waitFor(() => {
      expect(screen.getByText('Convert Session to Spec')).toBeInTheDocument()
    })

    const confirmButton = screen.getByRole('button', { name: /Convert to Spec/ })
    fireEvent.click(confirmButton)

    // Switch to spec filter to see the converted session
    fireEvent.click(screen.getByTitle('Show spec agents'))

    await waitFor(() => {
      const specButtons = screen.getAllByRole('button').filter(b => /s1-spec/.test(b.textContent || ''))
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
