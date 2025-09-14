import { render, screen, waitFor, act } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import userEvent from '@testing-library/user-event'
import type { Event } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { invoke } from '@tauri-apps/api/core'
import { TestProviders } from '../../tests/test-utils'
import { mockEnrichedSession, mockDraftSession } from '../../test-utils/sessionMocks'
import { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
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

let sessionRefreshCallback: ((event: Event<unknown>) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((eventName: string, callback: (event: Event<unknown>) => void) => {
        if (eventName === 'schaltwerk:sessions-refreshed') {
            sessionRefreshCallback = callback
        }
        return Promise.resolve(() => {})
    })
}))


describe('Sidebar - Selection on State Changes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

  it('selects first visible session when current selection disappears due to filter', async () => {
        const draftSession = mockDraftSession('spec-agent')
        const runningSession1 = mockEnrichedSession('running-agent-1', 'active', false)
        const runningSession2 = mockEnrichedSession('running-agent-2', 'active', false)

        // Start with a spec and two running sessions
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [draftSession, runningSession1, runningSession2]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
                const fm = (args as { filterMode?: string })?.filterMode || 'all'
                const all = [draftSession, runningSession1, runningSession2]
                if (fm === 'spec') return [draftSession]
                if (fm === 'reviewed') return all.filter(s => s.info.ready_to_merge)
                if (fm === 'running') return all.filter(s => !s.info.ready_to_merge && s.info.session_state !== 'spec')
                return all
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
  })

  

        render(<TestProviders><Sidebar /></TestProviders>)

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('spec-agent')).toBeInTheDocument()
            expect(screen.getByText('running-agent-1')).toBeInTheDocument()
            expect(screen.getByText('running-agent-2')).toBeInTheDocument()
        })

        // Select the spec agent
        await userEvent.click(screen.getByText('spec-agent'))
        
        // Verify spec is selected
        await waitFor(() => {
            const draftButton = screen.getByText('spec-agent').closest('[role="button"]')
            expect(draftButton).toHaveClass('session-ring-blue')
        })

        // Switch to running filter (spec will disappear)
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify first running session is automatically selected
        await waitFor(() => {
            const running1Button = screen.getByText('running-agent-1').closest('[role="button"]')
            expect(running1Button).toHaveClass('session-ring-blue')
        })
    })

    it('selects orchestrator when no sessions are visible after filter change', async () => {
        const draftSession = mockDraftSession('spec-agent')

        // Start with only a spec session
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [draftSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
                const fm = (args as { filterMode?: string })?.filterMode || 'all'
                const all = [draftSession]
                if (fm === 'spec') return all
                if (fm === 'running') return []
                if (fm === 'reviewed') return []
                return all
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(<TestProviders><Sidebar /></TestProviders>)

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('spec-agent')).toBeInTheDocument()
        })

        // Select the spec agent
        await userEvent.click(screen.getByText('spec-agent'))

        // Switch to running filter (no sessions will be visible)
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify orchestrator is automatically selected
        await waitFor(() => {
            const orchestratorButton = screen.getByText('orchestrator').closest('button')
            expect(orchestratorButton).toHaveClass('session-ring-blue')
        })
    })

    it('maintains selection when session remains visible after state change', async () => {
        const runningSession = mockEnrichedSession('agent-1', 'active', false)

        // Start with a running session
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [runningSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
                return [runningSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(<TestProviders><Sidebar /></TestProviders>)

        // Wait for session to load
        await waitFor(() => {
            expect(screen.getByText('agent-1')).toBeInTheDocument()
        })

        // Select the agent
        await userEvent.click(screen.getByText('agent-1'))

        // Update the session to be reviewed (still visible in "all" filter)
        const reviewedSession = { ...runningSession, info: { ...runningSession.info, ready_to_merge: true } }
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [reviewedSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        // Trigger session refresh event
        if (sessionRefreshCallback) {
            await act(async () => {
                await sessionRefreshCallback!({ event: 'schaltwerk:sessions-refreshed', id: 1, payload: [reviewedSession] } as Event<unknown>)
            })
        }

        // Verify agent is still selected (since it's still visible in "all" filter)
        await waitFor(() => {
            const taskButton = screen.getByText('agent-1').closest('[role="button"]')
            expect(taskButton).toHaveClass('session-ring-blue')
        })
    })

    it('selects orchestrator when no sessions visible after filter change with selected spec', async () => {
        const specAgent = mockDraftSession('spec-agent')
        const runningTask = mockEnrichedSession('running-agent', 'active', false)

        // Start with a spec and a running session
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [specAgent, runningTask]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) {
                const fm = (args as { filterMode?: string })?.filterMode || 'all'
                const all = [specAgent, runningTask]
                if (fm === 'spec') return [specAgent]
                if (fm === 'running') return [runningTask]
                if (fm === 'reviewed') return []
                return all
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(<TestProviders><Sidebar /></TestProviders>)

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('spec-agent')).toBeInTheDocument()
            expect(screen.getByText('running-agent')).toBeInTheDocument()
        })

        // First select the running agent in all view
        await userEvent.click(screen.getByText('running-agent'))
        
        // Switch to spec filter (running agent disappears)
        const draftFilterButton = screen.getByTitle('Show spec agents')
        await userEvent.click(draftFilterButton)
        
        // Verify spec agent is automatically selected (first visible)
        await waitFor(() => {
            const draftButton = screen.getByText('spec-agent').closest('[role="button"]')
            expect(draftButton).toHaveClass('session-ring-blue')
        })

        // Now select the spec and switch to running filter
        await userEvent.click(screen.getByText('spec-agent'))
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify running agent is automatically selected
        await waitFor(() => {
            const runningButton = screen.getByText('running-agent').closest('[role="button"]')
            expect(runningButton).toHaveClass('session-ring-blue')
        })
    })
})
