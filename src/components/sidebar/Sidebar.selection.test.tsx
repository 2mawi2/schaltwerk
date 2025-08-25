import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { invoke } from '@tauri-apps/api/core'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'
import { mockEnrichedSession, mockDraftSession } from '../../test-utils/sessionMocks'

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

let sessionRefreshCallback: ((event: any) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockImplementation((eventName: string, callback: (event: any) => void) => {
        if (eventName === 'schaltwerk:sessions-refreshed') {
            sessionRefreshCallback = callback
        }
        return Promise.resolve(() => {})
    })
}))

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ProjectProvider>
        <FontSizeProvider>
            <SessionsProvider>
                <SelectionProvider>
                    <FocusProvider>
                        {children}
                    </FocusProvider>
                </SelectionProvider>
            </SessionsProvider>
        </FontSizeProvider>
    </ProjectProvider>
)

describe('Sidebar - Selection on State Changes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
    })

    it('selects first visible session when current selection disappears due to filter', async () => {
        const draftSession = mockDraftSession('plan-agent')
        const runningSession1 = mockEnrichedSession('running-agent-1', 'active', false)
        const runningSession2 = mockEnrichedSession('running-agent-2', 'active', false)

        // Start with a plan and two running sessions
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return [draftSession, runningSession1, runningSession2]
            }
            if (cmd === 'para_core_list_enriched_sessions_sorted') {
                const fm = args?.filterMode || 'all'
                const all = [draftSession, runningSession1, runningSession2]
                if (fm === 'plan') return [draftSession]
                if (fm === 'reviewed') return all.filter(s => s.info.ready_to_merge)
                if (fm === 'running') return all.filter(s => !s.info.ready_to_merge && s.info.session_state !== 'plan')
                return all
            }
            if (cmd === 'para_core_list_sessions_by_state') {
                return []
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(
            <TestWrapper>
                <Sidebar />
            </TestWrapper>
        )

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('plan-agent')).toBeInTheDocument()
            expect(screen.getByText('running-agent-1')).toBeInTheDocument()
            expect(screen.getByText('running-agent-2')).toBeInTheDocument()
        })

        // Select the plan agent
        await userEvent.click(screen.getByText('plan-agent'))
        
        // Verify plan is selected
        await waitFor(() => {
            const draftButton = screen.getByText('plan-agent').closest('button')
            expect(draftButton).toHaveClass('session-ring-blue')
        })

        // Switch to running filter (plan will disappear)
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify first running session is automatically selected
        await waitFor(() => {
            const running1Button = screen.getByText('running-agent-1').closest('button')
            expect(running1Button).toHaveClass('session-ring-blue')
        })
    })

    it('selects commander when no sessions are visible after filter change', async () => {
        const draftSession = mockDraftSession('plan-agent')

        // Start with only a plan session
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return [draftSession]
            }
            if (cmd === 'para_core_list_enriched_sessions_sorted') {
                const fm = args?.filterMode || 'all'
                const all = [draftSession]
                if (fm === 'plan') return all
                if (fm === 'running') return []
                if (fm === 'reviewed') return []
                return all
            }
            if (cmd === 'para_core_list_sessions_by_state') {
                return []
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(
            <TestWrapper>
                <Sidebar />
            </TestWrapper>
        )

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('plan-agent')).toBeInTheDocument()
        })

        // Select the plan agent
        await userEvent.click(screen.getByText('plan-agent'))

        // Switch to running filter (no sessions will be visible)
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify commander is automatically selected
        await waitFor(() => {
            const orchestratorButton = screen.getByText('commander').closest('button')
            expect(orchestratorButton).toHaveClass('session-ring-blue')
        })
    })

    it('maintains selection when session remains visible after state change', async () => {
        const runningSession = mockEnrichedSession('agent-1', 'active', false)

        // Start with a running session
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return [runningSession]
            }
            if (cmd === 'para_core_list_enriched_sessions_sorted') {
                return [runningSession]
            }
            if (cmd === 'para_core_list_sessions_by_state') {
                return []
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(
            <TestWrapper>
                <Sidebar />
            </TestWrapper>
        )

        // Wait for session to load
        await waitFor(() => {
            expect(screen.getByText('agent-1')).toBeInTheDocument()
        })

        // Select the agent
        await userEvent.click(screen.getByText('agent-1'))

        // Update the session to be reviewed (still visible in "all" filter)
        const reviewedSession = { ...runningSession, info: { ...runningSession.info, ready_to_merge: true } }
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return [reviewedSession]
            }
            if (cmd === 'para_core_list_sessions_by_state') {
                return []
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        // Trigger session refresh event
        if (sessionRefreshCallback) {
            await act(async () => {
                await sessionRefreshCallback!({ payload: [reviewedSession] })
            })
        }

        // Verify agent is still selected (since it's still visible in "all" filter)
        await waitFor(() => {
            const taskButton = screen.getByText('agent-1').closest('button')
            expect(taskButton).toHaveClass('session-ring-blue')
        })
    })

    it('selects commander when no sessions visible after filter change with selected plan', async () => {
        const planAgent = mockDraftSession('plan-agent')
        const runningTask = mockEnrichedSession('running-agent', 'active', false)

        // Start with a plan and a running session
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
            if (cmd === 'para_core_list_enriched_sessions') {
                return [planAgent, runningTask]
            }
            if (cmd === 'para_core_list_enriched_sessions_sorted') {
                const fm = args?.filterMode || 'all'
                const all = [planAgent, runningTask]
                if (fm === 'plan') return [planAgent]
                if (fm === 'running') return [runningTask]
                if (fm === 'reviewed') return []
                return all
            }
            if (cmd === 'para_core_list_sessions_by_state') {
                return []
            }
            if (cmd === 'get_project_sessions_settings') {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            return undefined
        })

        render(
            <TestWrapper>
                <Sidebar />
            </TestWrapper>
        )

        // Wait for sessions to load
        await waitFor(() => {
            expect(screen.getByText('plan-agent')).toBeInTheDocument()
            expect(screen.getByText('running-agent')).toBeInTheDocument()
        })

        // First select the running agent in all view
        await userEvent.click(screen.getByText('running-agent'))
        
        // Switch to plan filter (running agent disappears)
        const draftFilterButton = screen.getByTitle('Show plan agents')
        await userEvent.click(draftFilterButton)
        
        // Verify plan agent is automatically selected (first visible)
        await waitFor(() => {
            const draftButton = screen.getByText('plan-agent').closest('button')
            expect(draftButton).toHaveClass('session-ring-blue')
        })

        // Now select the plan and switch to running filter
        await userEvent.click(screen.getByText('plan-agent'))
        const runningFilterButton = screen.getByTitle('Show running agents')
        await userEvent.click(runningFilterButton)

        // Verify running agent is automatically selected
        await waitFor(() => {
            const runningButton = screen.getByText('running-agent').closest('button')
            expect(runningButton).toHaveClass('session-ring-blue')
        })
    })
})
