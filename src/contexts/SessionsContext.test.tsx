import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { SessionsProvider, useSessions } from './SessionsContext'
import { ProjectProvider } from './ProjectContext'
import type { Event } from '@tauri-apps/api/event'

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
            session_id: 'test-spec',
            display_name: 'Test Spec',
            branch: 'feature/test-spec',
            worktree_path: '/path/to/spec',
            base_branch: 'main',
            status: 'spec',
            session_state: 'spec',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: false
        },
        terminals: []
    },
    {
        info: {
            session_id: 'test-active',
            display_name: 'Test Active',
            branch: 'feature/test-active',
            worktree_path: '/path/to/active',
            base_branch: 'main',
            status: 'active',
            session_state: 'running',
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
            status: 'dirty',
            session_state: 'reviewed',
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

        // Sessions are sorted with unreviewed first (alphabetically), then reviewed at bottom (alphabetically)
        const unreviewed = mockSessions.filter(s => !s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const reviewed = mockSessions.filter(s => s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const expectedSessions = [...unreviewed, ...reviewed]
        expect(result.current.sessions).toEqual(expectedSessions)
    })

    it('should update session status from spec to active', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        let _callCount = 0
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            _callCount++
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_start_spec_session') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.updateSessionStatus('test-spec', 'active')
        })

        // First call is to get current sessions, second is start_draft_session, third is reload
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions')
        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_start_spec_session', { name: 'test-spec' })
    })

    it('should update session status from active to spec', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_convert_session_to_draft') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.updateSessionStatus('test-active', 'spec')
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

    it('should create a new spec session', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'schaltwerk_core_list_enriched_sessions') return mockSessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return mockSessions
            if (cmd === 'schaltwerk_core_create_spec_session') return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.createDraft('new-spec', '# New Spec')
        })

        expect(invoke).toHaveBeenCalledWith('schaltwerk_core_create_spec_session', {
            name: 'new-spec',
            specContent: '# New Spec'
        })
    })

    it('should handle session refresh events', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        
        vi.mocked(listen).mockImplementation(async (event: string, handler: (event: Event<unknown>) => void) => {
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
                    status: 'active',
                session_state: 'running',
                is_current: false,
                session_type: 'worktree',
                ready_to_merge: false
            },
            terminals: []
        }]

        // Simulate event
        act(() => {
            if (listeners['schaltwerk:sessions-refreshed']) {
                listeners['schaltwerk:sessions-refreshed']({ 
                    event: 'schaltwerk:sessions-refreshed', 
                    id: 1, 
                    payload: newSessions 
                })
            }
        })

        // Sessions are sorted with unreviewed first (alphabetically), then reviewed at bottom (alphabetically)
        const unreviewedNew = newSessions.filter(s => !s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const reviewedNew = newSessions.filter(s => s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const expectedSessions = [...unreviewedNew, ...reviewedNew]
        expect(result.current.sessions).toEqual(expectedSessions)
    })

    it('should handle session removal events', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        
        vi.mocked(listen).mockImplementation(async (event: string, handler: (event: Event<unknown>) => void) => {
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

        // Wait for initial load - sessions are sorted with unreviewed first, then reviewed at bottom
        const unreviewedMock = mockSessions.filter(s => !s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const reviewedMock = mockSessions.filter(s => s.info.ready_to_merge).sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))
        const expectedSessions = [...unreviewedMock, ...reviewedMock]
        await waitFor(() => {
            expect(result.current.sessions).toEqual(expectedSessions)
        })

        // Simulate removal event
        act(() => {
            if (listeners['schaltwerk:session-removed']) {
                listeners['schaltwerk:session-removed']({ 
                    event: 'schaltwerk:session-removed', 
                    id: 2, 
                    payload: { session_name: 'test-spec' } 
                })
            }
        })

        expect(result.current.sessions).toHaveLength(2)
        expect(result.current.sessions.find(s => s.info.session_id === 'test-spec')).toBeUndefined()
    })
})