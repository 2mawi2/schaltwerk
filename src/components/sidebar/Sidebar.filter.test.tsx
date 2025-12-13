import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { FilterMode } from '../../types/sessionFilters'
import { EnrichedSession } from '../../types/session'

vi.mock('@tauri-apps/api/core')

let eventHandlers: Record<string, ((_event: unknown) => void)[]> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, handler: (_event: unknown) => void) => {
    if (!eventHandlers[event]) {
      eventHandlers[event] = []
    }
    eventHandlers[event].push(handler)
    return Promise.resolve(() => {
      eventHandlers[event] = eventHandlers[event].filter(h => h !== handler)
    })
  }),
  emit: vi.fn()
}))

const emitEvent = async (eventName: string, payload?: unknown) => {
  const handlers = eventHandlers[eventName] || []
  await Promise.all(handlers.map(handler => Promise.resolve(handler({ payload }))))
}

// TestProviders supplies a default project path for Sidebar


const createSession = (id: string, readyToMerge = false, sessionState?: 'spec' | 'active'): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
    session_state: sessionState === 'spec' ? 'spec' : (readyToMerge ? 'reviewed' : 'running')
  },
  terminals: []
})


describe('Sidebar filter functionality and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    eventHandlers = {}

    const sessions = [
      createSession('alpha', false, 'spec'),
      createSession('bravo', false, 'active'),  // running
      createSession('charlie', false, 'spec'),
      createSession('delta', true, 'active'),  // reviewed
      createSession('echo', true, 'active'),  // reviewed
    ]

    vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === 'get_buffer') return ''
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: FilterMode.Running }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('filters sessions: Running -> Specs -> Reviewed', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load (verify by filter counts) - defaults to Running filter
    await waitFor(() => {
      const runningButton = screen.getByTitle('Show running agents')
      // bravo is running (not spec, not reviewed)
      expect(runningButton.textContent).toContain('1')
    })

    // Click Specs
    fireEvent.click(screen.getByTitle('Show spec agents'))

    await waitFor(() => {
      const specsButton = screen.getByTitle('Show spec agents')
      expect(specsButton.textContent).toContain('2') // alpha and charlie are specs (session_state: 'spec')
    })

    // Click Reviewed
    fireEvent.click(screen.getByTitle('Show reviewed agents'))

    await waitFor(() => {
      // Check that the filter counter shows the right numbers
      const reviewedButton = screen.getByTitle('Show reviewed agents')
      expect(reviewedButton.textContent).toContain('2') // bravo and delta are reviewed
    })

    // Back to Running
    fireEvent.click(screen.getByTitle('Show running agents'))

    await waitFor(() => {
      const runningButton = screen.getByTitle('Show running agents')
      expect(runningButton.textContent).toContain('1')
    })
  })

  it('persists filterMode to backend and restores it', async () => {
    // Mock backend settings storage
    let savedFilterMode = 'running'
    let settingsLoadCalled = false

    const allSessions = [
      createSession('session1'),
      createSession('session2'),
      createSession('session3', true),
      createSession('session4', true),
    ]

    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetProjectSessionsSettings) {
        settingsLoadCalled = true
        return { filter_mode: savedFilterMode }
      }
      if (command === TauriCommands.SetProjectSessionsSettings) {
        if (settingsLoadCalled) {
          const s = (args as Record<string, unknown>)?.settings as Record<string, unknown> || {}
          savedFilterMode = (s.filter_mode as string) || 'running'
        }
        return undefined
      }
      if (command === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return allSessions
      }
      if (command === TauriCommands.GetCurrentDirectory) return '/test/dir'
      if (command === TauriCommands.TerminalExists) return false
      if (command === TauriCommands.CreateTerminal) return true
      if (command === 'get_buffer') return ''
      if (command === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      return undefined
    })

    // First render: starts at Running, switch to Reviewed
    const { unmount } = render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const runningButton = screen.getByTitle('Show running agents')
      expect(runningButton.textContent).toContain('2') // session1 and session2 are running
    })

    fireEvent.click(screen.getByTitle('Show reviewed agents'))

    await waitFor(() => {
      expect(savedFilterMode).toBe('reviewed')
    })

    unmount()

    // Second render should restore 'reviewed'
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const reviewedButton = screen.getByTitle('Show reviewed agents')
      expect(reviewedButton.textContent).toContain('2') // session3 and session4 are reviewed
    })
  })

  describe('Reviewed session preservation with Running filter', () => {
    it('preserves selection when currently selected session is marked as reviewed while Running filter is active', async () => {
      let sessionsList: EnrichedSession[] = [
        createSession('running-1', false, 'active'),
        createSession('running-2', false, 'active'),
        createSession('running-3', false, 'active'),
      ]

      const mockSetSelection = vi.fn()
      let currentFilterMode = FilterMode.Running

      vi.mocked(invoke).mockImplementation(async (cmd, args?: unknown) => {
        if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
          return sessionsList
        }
        if (cmd === TauriCommands.GetProjectSessionsSettings) {
          return { filter_mode: currentFilterMode }
        }
        if (cmd === TauriCommands.SetProjectSessionsSettings) {
          const settings = (args as Record<string, unknown>)?.settings as Record<string, unknown>
          if (settings?.filter_mode) {
            currentFilterMode = settings.filter_mode as FilterMode
          }
          return undefined
        }
        if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
        if (cmd === TauriCommands.TerminalExists) return false
        if (cmd === TauriCommands.CreateTerminal) return true
        if (cmd === 'get_buffer') return ''
        if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
        return undefined
      })

      render(<TestProviders><Sidebar /></TestProviders>)

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('3')
      })

      const runningButton = screen.getByTitle('Show running agents')
      fireEvent.click(runningButton)

      await waitFor(() => {
        const sessions = screen.getAllByRole('button').filter(b => (b.textContent || '').includes('para/'))
        expect(sessions).toHaveLength(3)
      })

      const firstSessionButton = screen.getAllByRole('button').find(b => b.textContent?.includes('running-1'))
      expect(firstSessionButton).toBeInTheDocument()
      fireEvent.click(firstSessionButton!)

      sessionsList = [
        createSession('running-1', true, 'active'),
        createSession('running-2', false, 'active'),
        createSession('running-3', false, 'active'),
      ]

      await act(async () => {
        await emitEvent('schaltwerk:sessions-refreshed', sessionsList)
      })

      await waitFor(() => {
        const runningCount = screen.getByTitle('Show running agents')
        expect(runningCount.textContent).toContain('2')
      })

      expect(mockSetSelection).not.toHaveBeenCalledWith(
        expect.objectContaining({ payload: 'running-2' }),
        expect.anything(),
        expect.anything()
      )
    })

    it('preserves selection when first session moves to reviewed with Running filter active', async () => {
      let sessionsList: EnrichedSession[] = [
        createSession('alpha', false, 'active'),
        createSession('beta', false, 'active'),
        createSession('gamma', false, 'active'),
      ]

      vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
        if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
          return sessionsList
        }
        if (cmd === TauriCommands.GetProjectSessionsSettings) {
          return { filter_mode: FilterMode.Running }
        }
        if (cmd === TauriCommands.SetProjectSessionsSettings) {
          return undefined
        }
        if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
        if (cmd === TauriCommands.TerminalExists) return false
        if (cmd === TauriCommands.CreateTerminal) return true
        if (cmd === 'get_buffer') return ''
        if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
        return undefined
      })

      render(<TestProviders><Sidebar /></TestProviders>)

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('3')
      })

      const alphaButton = screen.getAllByRole('button').find(b => b.textContent?.includes('alpha'))
      expect(alphaButton).toBeInTheDocument()
      fireEvent.click(alphaButton!)

      sessionsList = [
        createSession('alpha', true, 'active'),
        createSession('beta', false, 'active'),
        createSession('gamma', false, 'active'),
      ]

      await act(async () => {
        await emitEvent('schaltwerk:sessions-refreshed', sessionsList)
      })

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('2')
        const reviewedButton = screen.getByTitle('Show reviewed agents')
        expect(reviewedButton.textContent).toContain('1')
      })
    })

    it('allows switching to different session after reviewed session disappears from Running filter', async () => {
      let sessionsList: EnrichedSession[] = [
        createSession('session-1', false, 'active'),
        createSession('session-2', false, 'active'),
      ]

      vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
        if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
          return sessionsList
        }
        if (cmd === TauriCommands.GetProjectSessionsSettings) {
          return { filter_mode: FilterMode.Running }
        }
        if (cmd === TauriCommands.SetProjectSessionsSettings) {
          return undefined
        }
        if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
        if (cmd === TauriCommands.TerminalExists) return false
        if (cmd === TauriCommands.CreateTerminal) return true
        if (cmd === 'get_buffer') return ''
        if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
        return undefined
      })

      render(<TestProviders><Sidebar /></TestProviders>)

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('2')
      })

      const session1Button = screen.getAllByRole('button').find(b => b.textContent?.includes('session-1'))
      fireEvent.click(session1Button!)

      sessionsList = [
        createSession('session-1', true, 'active'),
        createSession('session-2', false, 'active'),
      ]

      await act(async () => {
        await emitEvent('schaltwerk:sessions-refreshed', sessionsList)
      })

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('1')
      })

      const session2Button = screen.getAllByRole('button').find(b => b.textContent?.includes('session-2'))
      expect(session2Button).toBeInTheDocument()
      fireEvent.click(session2Button!)

      await waitFor(() => {
        expect(session2Button).toHaveClass('session-ring')
      })
    })

    it('does not preserve selection when session is removed (not just marked reviewed)', async () => {
      let sessionsList: EnrichedSession[] = [
        createSession('temp-1', false, 'active'),
        createSession('temp-2', false, 'active'),
      ]

      vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
        if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
          return sessionsList
        }
        if (cmd === TauriCommands.GetProjectSessionsSettings) {
          return { filter_mode: FilterMode.Running }
        }
        if (cmd === TauriCommands.SetProjectSessionsSettings) {
          return undefined
        }
        if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
        if (cmd === TauriCommands.TerminalExists) return false
        if (cmd === TauriCommands.CreateTerminal) return true
        if (cmd === 'get_buffer') return ''
        if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
        return undefined
      })

      render(<TestProviders><Sidebar /></TestProviders>)

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('2')
      })

      const temp1Button = screen.getAllByRole('button').find(b => b.textContent?.includes('temp-1'))
      fireEvent.click(temp1Button!)

      sessionsList = [
        createSession('temp-2', false, 'active'),
      ]

      await act(async () => {
        await emitEvent('schaltwerk:sessions-refreshed', sessionsList)
      })

      await waitFor(() => {
        const runningButton = screen.getByTitle('Show running agents')
        expect(runningButton.textContent).toContain('1')
      })
    })
  })
})
