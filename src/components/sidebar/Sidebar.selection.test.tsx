import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Event } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { mockEnrichedSession } from '../../test-utils/sessionMocks'
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent } from '../../common/eventSystem'
import { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

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

const listeners: Record<string, Array<(event: Event<unknown>) => void>> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockImplementation((eventName: string, callback: (event: Event<unknown>) => void) => {
    if (!listeners[eventName]) listeners[eventName] = []
    listeners[eventName].push(callback)
    return Promise.resolve(() => {
      listeners[eventName] = (listeners[eventName] || []).filter(fn => fn !== callback)
      if (listeners[eventName]?.length === 0) {
        delete listeners[eventName]
      }
    })
  })
})

describe('Reviewed session cancellation focus preservation', () => {
  let currentSessions: unknown[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(listeners).forEach(key => delete listeners[key])
    localStorage.clear()

    // Set up the mock to return sessions
    const currentSession = mockEnrichedSession('current-session', 'active', false)
    const reviewedSession = mockEnrichedSession('reviewed-session', 'active', true)
    const anotherSession = mockEnrichedSession('another-session', 'active', false)

    currentSessions = [currentSession, reviewedSession, anotherSession]

    // Create a dynamic mock that always returns current sessions
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      // Always use the current value of currentSessions
      const sessions = (globalThis as any).__testCurrentSessions || currentSessions
      console.log('Mock invoke called:', cmd, 'with sessions:', sessions.length, 'session names:', sessions.map((s: unknown) => (s as any).info.session_id))
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        console.log('Returning sessions:', sessions)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
        const mode = (args as { filterMode?: string })?.filterMode || 'all'
        const filtered = mode === 'spec' ? sessions.filter((s: unknown) => (s as any).info.session_state === 'spec') :
                        mode === 'running' ? sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge) :
                        mode === 'reviewed' ? sessions.filter((s: unknown) => (s as any).info.ready_to_merge) : sessions
        console.log('Returning filtered sessions for mode', mode, ':', filtered.length)
        if (mode === 'spec') return sessions.filter((s: unknown) => (s as any).info.session_state === 'spec')
        if (mode === 'running') return sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge)
        if (mode === 'reviewed') return sessions.filter((s: unknown) => (s as any).info.ready_to_merge)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return undefined
    })
  })

  async function emitEvent(event: SchaltEvent, payload: unknown) {
    const handlers = listeners[event]
    if (!handlers || handlers.length === 0) {
      throw new Error(`No handler registered for ${event}`)
    }

    // Remove session from mock data when SessionRemoved event is emitted
    if (event === SchaltEvent.SessionRemoved) {
      const sessionName = (payload as { session_name: string }).session_name
      currentSessions = currentSessions.filter((s: unknown) => (s as any).info.session_id !== sessionName)
      // Update global reference so mock can access updated sessions
      ;(globalThis as any).__testCurrentSessions = currentSessions
      console.log('Session removed:', sessionName, 'Remaining sessions:', currentSessions.length)
    }

    await act(async () => {
      for (const handler of handlers) {
        await handler({ event, id: 0, payload } as Event<unknown>)
      }
    })
  }

  it('preserves focus on current session when a reviewed session is cancelled', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('current-session') || text.includes('reviewed-session') || text.includes('another-session')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Select the current session
    await userEvent.click(screen.getByText('current-session'))
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
    })

    // Cancel the reviewed session via MCP server (emit SessionRemoved event)
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'reviewed-session' })

    // Focus should remain on current session, not switch to another-session
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      const anotherButton = screen.getByText('another-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
      expect(anotherButton).not.toHaveClass('session-ring-blue')
    })
  })

  it('falls back to orchestrator when current selection becomes invalid after reviewed session cancellation', async () => {
    const reviewedSession = mockEnrichedSession('reviewed-session', 'active', true)
    const sessions = [reviewedSession]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
        const mode = (args as { filterMode?: string })?.filterMode || 'all'
        if (mode === 'spec') return sessions.filter((s: unknown) => (s as any).info.session_state === 'spec')
        if (mode === 'running') return sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge)
        if (mode === 'reviewed') return sessions.filter((s: unknown) => (s as any).info.ready_to_merge)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('reviewed-session')
      })
      expect(sessionButtons).toHaveLength(1)
    })

    // Select the reviewed session
    await userEvent.click(screen.getByText('reviewed-session'))
    await waitFor(() => {
      const reviewedButton = screen.getByText('reviewed-session').closest('[role="button"]')
      expect(reviewedButton).toHaveClass('session-ring-blue')
    })

    // Cancel the reviewed session
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'reviewed-session' })

    // Should fall back to orchestrator since current selection is no longer valid
    await waitFor(() => {
      const orchestratorButton = screen.getByText('orchestrator').closest('button')
      expect(orchestratorButton).toHaveClass('session-ring-blue')
    })
  })

  it('continues normal auto-selection behavior for non-reviewed session cancellation', async () => {
    const currentSession = mockEnrichedSession('current-session', 'active', false)
    const runningSession = mockEnrichedSession('running-session', 'active', false)
    const specSession = mockEnrichedSession('spec-session', 'active', false)

    currentSessions = [currentSession, runningSession, specSession]

   render(<TestProviders><Sidebar /></TestProviders>)

   // Wait for sessions to load
   await waitFor(() => {
     const allButtons = screen.getAllByRole('button')
     console.log('All buttons found:', allButtons.length)
     allButtons.forEach((btn, index) => {
       console.log(`Button ${index}:`, btn.textContent, 'Classes:', btn.className)
     })

     const sessionButtons = allButtons.filter(btn => {
       const text = btn.textContent || ''
       return text.includes('current-session') || text.includes('running-session') || text.includes('spec-session')
     })
     console.log('Session buttons found:', sessionButtons.length)
     console.log('Current sessions in mock:', currentSessions.length, 'session names:', currentSessions.map((s: unknown) => (s as any).info.session_id))
     expect(sessionButtons).toHaveLength(3)
   })

   // Select the running session
   await userEvent.click(screen.getByText('running-session'))
   await waitFor(() => {
     const runningButton = screen.getByText('running-session').closest('[role="button"]')
     expect(runningButton).toHaveClass('session-ring-blue')
   })

   // Cancel the running session
   await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'running-session' })

   // Check what sessions are visible after removal
   await waitFor(() => {
     const sessionButtons = screen.getAllByRole('button').filter(btn => {
       const text = btn.textContent || ''
       return text.includes('current-session') || text.includes('spec-session')
     })
     console.log('Visible sessions after removal:', sessionButtons.length)
     sessionButtons.forEach(btn => console.log('Session:', btn.textContent, 'Classes:', btn.className))
     expect(sessionButtons).toHaveLength(2)
   })

   // Should auto-select to the next available session (spec-session)
   await waitFor(() => {
     const specButton = screen.getByText('spec-session').closest('[role="button"]')
     expect(specButton).toHaveClass('session-ring-blue')
   })

   // And current should not be selected
   await waitFor(() => {
     const currentButton = screen.getByText('current-session').closest('[role="button"]')
     expect(currentButton).not.toHaveClass('session-ring-blue')
   })
 })

  it('handles multiple reviewed sessions correctly during cancellation', async () => {
    const currentSession = mockEnrichedSession('current-session', 'active', false)
    const reviewedSession1 = mockEnrichedSession('reviewed-1', 'active', true)
    const reviewedSession2 = mockEnrichedSession('reviewed-2', 'active', true)

    const sessions = [currentSession, reviewedSession1, reviewedSession2]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
        const mode = (args as { filterMode?: string })?.filterMode || 'all'
        if (mode === 'spec') return sessions.filter((s: unknown) => (s as any).info.session_state === 'spec')
        if (mode === 'running') return sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge)
        if (mode === 'reviewed') return sessions.filter((s: unknown) => (s as any).info.ready_to_merge)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('current-session') || text.includes('reviewed-1') || text.includes('reviewed-2')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Select the current session
    await userEvent.click(screen.getByText('current-session'))
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
    })

    // Cancel one reviewed session
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'reviewed-1' })

    // Focus should remain on current session
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
    })
  })

  it('works correctly when reviewed session is the current selection', async () => {
    const reviewedSession = mockEnrichedSession('reviewed-session', 'active', true)
    const sessions = [reviewedSession]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
        const mode = (args as { filterMode?: string })?.filterMode || 'all'
        if (mode === 'spec') return sessions.filter((s: unknown) => (s as any).info.session_state === 'spec')
        if (mode === 'running') return sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge)
        if (mode === 'reviewed') return sessions.filter((s: unknown) => (s as any).info.ready_to_merge)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('reviewed-session')
      })
      expect(sessionButtons).toHaveLength(1)
    })

    // Select the reviewed session
    await userEvent.click(screen.getByText('reviewed-session'))
    await waitFor(() => {
      const reviewedButton = screen.getByText('reviewed-session').closest('[role="button"]')
      expect(reviewedButton).toHaveClass('session-ring-blue')
    })

    // Cancel the current reviewed session
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'reviewed-session' })

    // Should fall back to orchestrator
    await waitFor(() => {
      const orchestratorButton = screen.getByText('orchestrator').closest('button')
      expect(orchestratorButton).toHaveClass('session-ring-blue')
    })
  })

  it('preserves focus when cancelling reviewed session in filtered view', async () => {
    const currentSession = mockEnrichedSession('current-session', 'active', false)
    const reviewedSession = mockEnrichedSession('reviewed-session', 'active', true)
    const anotherSession = mockEnrichedSession('another-session', 'active', false)

    const sessions = [currentSession, reviewedSession, anotherSession]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
        const mode = (args as { filterMode?: string })?.filterMode || 'all'
        if (mode === 'spec') return sessions.filter((s: unknown) => (s as any).info.session_state === 'spec')
        if (mode === 'running') return sessions.filter((s: unknown) => (s as any).info.session_state !== 'spec' && !(s as any).info.ready_to_merge)
        if (mode === 'reviewed') return sessions.filter((s: unknown) => (s as any).info.ready_to_merge)
        return sessions
      }
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('current-session') || text.includes('reviewed-session') || text.includes('another-session')
      })
      expect(sessionButtons).toHaveLength(3)
    })

    // Switch to running filter
    const runningFilterButton = screen.getByTitle('Show running agents')
    await userEvent.click(runningFilterButton)

    // Select the current session
    await userEvent.click(screen.getByText('current-session'))
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
    })

    // Cancel the reviewed session (which is not visible in running filter)
    await emitEvent(SchaltEvent.SessionRemoved, { session_name: 'reviewed-session' })

    // Focus should remain on current session
    await waitFor(() => {
      const currentButton = screen.getByText('current-session').closest('[role="button"]')
      expect(currentButton).toHaveClass('session-ring-blue')
    })
  })
})