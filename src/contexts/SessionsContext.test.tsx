import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { SessionsProvider, useSessions } from './SessionsContext'
import { ProjectProvider } from './ProjectContext'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {}))
}))

const mockSessions = [
    {
        info: {
            session_id: 'test-plan',
            display_name: 'Test Plan',
            branch: 'feature/test-plan',
            worktree_path: '/path/to/plan',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'plan',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: false
        },
        terminals: ['session-test-plan-top', 'session-test-plan-bottom']
    },
    {
        info: {
            session_id: 'test-active',
            display_name: 'Test Active',
            branch: 'feature/test-active',
            worktree_path: '/path/to/active',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: true,
            session_type: 'worktree',
            ready_to_merge: false
        },
        terminals: ['session-test-active-top', 'session-test-active-bottom']
    },
    {
        info: {
            session_id: 'test-ready',
            display_name: 'Test Ready',
            branch: 'feature/test-ready',
            worktree_path: '/path/to/ready',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'dirty',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: true
        },
        terminals: ['session-test-ready-top', 'session-test-ready-bottom']
    }
]

describe('SessionsContext', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
        <ProjectProvider>
            <SessionsProvider>{children}</SessionsProvider>
        </ProjectProvider>
    )

    it('should provide initial empty state when no project is selected', async () => {
        const { result } = renderHook(() => useSessions(), { wrapper })
        
        // Wait for initialization to complete
        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })
        
        expect(result.current.sessions).toEqual([])
    })

    it('should load sessions when project is available', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'get_project_sessions_settings') return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === 'set_project_sessions_settings') return undefined
            return undefined
        })

        // Mock ProjectProvider to have a project
        const wrapperWithProject = ({ children }: { children: ReactNode }) => (
            <ProjectProvider>
                <SessionsProvider>{children}</SessionsProvider>
            </ProjectProvider>
        )

        // We need to mock the projectPath being set
        vi.mock('./ProjectContext', async () => {
            const actual = await vi.importActual('./ProjectContext')
            return {
                ...actual,
                useProject: () => ({ projectPath: '/test/project' })
            }
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        // Sessions are now sorted alphabetically by name (SortMode.Name is default)
        const expectedSessions = [...mockSessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        expect(result.current.sessions).toEqual(expectedSessions)
    })

    it('should update session status from plan to active', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        let callCount = 0
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            callCount++
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_start_draft_session') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.updateSessionStatus('test-plan', 'active')
        })

        // First call is to get current sessions, second is start_draft_session, third is reload
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions')
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_start_draft_session', { name: 'test-plan' })
    })

    it('should update session status from active to plan', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_convert_session_to_draft') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.updateSessionStatus('test-active', 'plan')
        })

        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions')
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_convert_session_to_draft', { name: 'test-active' })
    })

    it('should mark session as ready for merge', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_mark_ready') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.updateSessionStatus('test-active', 'dirty')
        })

        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions')
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_mark_ready', { name: 'test-active' })
    })

    it('should create a new plan session', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_create_draft_session') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.createDraft('new-plan', '# New Plan')
        })

        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_create_draft_session', {
            name: 'new-plan',
            planContent: '# New Plan'
        })
    })

    it('should handle session refresh events', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: any = {}
        
        vi.mocked(listen).mockImplementation(async (event: string, handler: any) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'get_project_sessions_settings') return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === 'set_project_sessions_settings') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        const newSessions = [...mockSessions, {
            info: {
                session_id: 'new-session',
                display_name: 'New Session',
                branch: 'feature/new',
                worktree_path: '/path/to/new',
                base_branch: 'main',
                merge_mode: 'rebase',
                status: 'active',
                is_current: false,
                session_type: 'worktree',
                ready_to_merge: false
            },
            terminals: []
        }]

        // Simulate event
        act(() => {
            if (listeners['schaltwerk:sessions-refreshed']) {
                listeners['schaltwerk:sessions-refreshed']({ payload: newSessions })
            }
        })

        // Sessions are now sorted alphabetically by name (SortMode.Name is default)
        const expectedSessions = [...newSessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        expect(result.current.sessions).toEqual(expectedSessions)
    })

    it('should handle session removal events', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: any = {}
        
        vi.mocked(listen).mockImplementation(async (event: string, handler: any) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'get_project_sessions_settings') return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === 'set_project_sessions_settings') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        // Wait for initial load - sessions are sorted alphabetically
        const expectedSessions = [...mockSessions].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        await waitFor(() => {
            expect(result.current.sessions).toEqual(expectedSessions)
        })

        // Simulate removal event
        act(() => {
            if (listeners['schaltwerk:session-removed']) {
                listeners['schaltwerk:session-removed']({ payload: { session_name: 'test-plan' } })
            }
        })

        expect(result.current.sessions).toHaveLength(2)
        expect(result.current.sessions.find(s => s.info.session_id === 'test-plan')).toBeUndefined()
    })
})