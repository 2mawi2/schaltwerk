import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode, useEffect } from 'react'
import { SessionsProvider, useSessions } from './SessionsContext'
import { ProjectProvider, useProject } from './ProjectContext'
import type { Event } from '@tauri-apps/api/event'
import { SortMode } from '../types/sessionFilters'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
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
            created_at: '2024-01-01T00:00:00.000Z',
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
            created_at: '2024-01-02T00:00:00.000Z',
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
            created_at: '2023-12-31T00:00:00.000Z',
            is_current: false,
            session_type: 'worktree',
            ready_to_merge: true
        },
        terminals: ['session-test-ready-top', 'session-test-ready-bottom']
    }
]

const ProjectSetter = ({ path }: { path: string }) => {
    const { setProjectPath } = useProject()
    useEffect(() => {
        setProjectPath(path)
    }, [path, setProjectPath])
    return null
}

describe('SessionsContext', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
        <ProjectProvider>
            <SessionsProvider>{children}</SessionsProvider>
        </ProjectProvider>
    )

    const wrapperWithProject = ({ children }: { children: ReactNode }) => (
        <ProjectProvider>
            <ProjectSetter path="/test/project" />
            <SessionsProvider>{children}</SessionsProvider>
        </ProjectProvider>
    )

    it('should provide initial empty state when no project is selected', async () => {
        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })
        
        // Wait for initialization to complete
        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })
        
        expect(result.current.sessions).toEqual([])
    })

    it('should load sessions when project is available', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            return undefined
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
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreStartSpecSession) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await act(async () => {
            await result.current.updateSessionStatus('test-spec', 'active')
        })

        // First call is to get current sessions, second is start_draft_session, third is reload
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListEnrichedSessions)
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartSpecSession, { name: 'test-spec' })
    })

    it('should update session status from active to spec', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreConvertSessionToDraft) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await act(async () => {
            await result.current.updateSessionStatus('test-active', 'spec')
        })

        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListEnrichedSessions)
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreConvertSessionToDraft, { name: 'test-active' })
    })

    it('should mark session as ready for merge', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreMarkReady) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await act(async () => {
            await result.current.updateSessionStatus('test-active', 'dirty')
        })

        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListEnrichedSessions)
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkReady, { name: 'test-active' })
    })

    it('should create a new spec session', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreCreateSpecSession) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await act(async () => {
            await result.current.createDraft('new-spec', '# New Spec')
        })

        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreCreateSpecSession, {
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
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
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

    it('deduplicates sessions when refresh payload contains duplicates', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}

        vi.mocked(listen).mockImplementation(async (event: string, handler: (event: Event<unknown>) => void) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await waitFor(() => {
            expect(listeners['schaltwerk:sessions-refreshed']).toBeTruthy()
        })

        const duplicateSession = {
            info: {
                session_id: 'dupe-session',
                display_name: 'Duplicate Session',
                branch: 'feature/dupe',
                worktree_path: '/path/to/dupe',
                base_branch: 'main',
                status: 'active',
                session_state: 'running',
                is_current: false,
                session_type: 'worktree',
                ready_to_merge: false
            },
            terminals: []
        }

        act(() => {
            const emit = listeners['schaltwerk:sessions-refreshed']
            if (emit) {
                emit({
                    event: 'schaltwerk:sessions-refreshed',
                    id: 42,
                    payload: [...mockSessions, duplicateSession, { ...duplicateSession }]
                })
            }
        })

        const occurrences = result.current.sessions.filter(s => s.info.session_id === 'dupe-session')
        expect(occurrences).toHaveLength(1)
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
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        // Seed initial sessions via refresh event to avoid relying on backend fetch timing
        act(() => {
            listeners['schaltwerk:sessions-refreshed']?.({
                event: 'schaltwerk:sessions-refreshed',
                id: 99,
                payload: mockSessions,
            } as Event<unknown>)
        })

        // Sessions are sorted with unreviewed first, then reviewed at bottom
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

    it('should keep creation sort order when SessionAdded fires', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'created' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        await waitFor(() => {
            expect(result.current.sortMode).toBe(SortMode.Created)
        })

        const { listen } = await import('@tauri-apps/api/event')

        await waitFor(() => {
            expect(vi.mocked(listen).mock.calls.some(call => call[0] === 'schaltwerk:session-added')).toBe(true)
        })

        const sessionAddedHandler = vi
            .mocked(listen)
            .mock.calls
            .reverse()
            .find(call => call[0] === 'schaltwerk:session-added')?.[1]
        expect(sessionAddedHandler).toBeDefined()

        const createdAt = '2025-09-20T12:00:00.000Z'

        await act(async () => {
            sessionAddedHandler?.({
                event: 'schaltwerk:session-added',
                id: 99,
                payload: {
                    session_name: 'new-session',
                    branch: 'feature/new-session',
                    worktree_path: '/path/to/new',
                    parent_branch: 'main',
                    created_at: createdAt,
                    last_modified: createdAt,
                }
            } as Event<unknown>)
        })

        await waitFor(() => {
            expect(result.current.sessions[0]?.info.session_id).toBe('new-session')
        })

        expect(result.current.sessions[0]?.info.created_at).toBe(createdAt)
    })

    it('auto-starts new sessions with SchaltwerkCoreStartClaude', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreStartClaude) return 'started'
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const { listen } = await import('@tauri-apps/api/event')
        await waitFor(() => {
            expect(vi.mocked(listen).mock.calls.some(call => call[0] === 'schaltwerk:session-added')).toBe(true)
        })

        const sessionAddedHandler = vi
            .mocked(listen)
            .mock.calls
            .reverse()
            .find(call => call[0] === 'schaltwerk:session-added')?.[1]
        expect(sessionAddedHandler).toBeDefined()

        await act(async () => {
            sessionAddedHandler?.({
                event: 'schaltwerk:session-added',
                id: 1001,
                payload: {
                    session_name: 'bg-new',
                    branch: 'feature/bg-new',
                    worktree_path: '/tmp/bg',
                    parent_branch: 'main',
                    created_at: '2025-09-20T12:34:56.000Z',
                    last_modified: '2025-09-20T12:34:56.000Z',
                }
            } as Event<unknown>)
        })

        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith(
                TauriCommands.SchaltwerkCoreStartClaude,
                expect.objectContaining({ sessionName: 'bg-new' })
            )
        })
    })

    it('skips auto-start when a background-start mark already exists', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreStartClaude) return 'started'
            return undefined
        })

        const { markBackgroundStart, __debug_getBackgroundStartIds } = await import('../common/uiEvents')

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })
        await waitFor(() => expect(result.current.loading).toBe(false))

        const { listen } = await import('@tauri-apps/api/event')
        await waitFor(() => {
            expect(vi.mocked(listen).mock.calls.some(call => call[0] === 'schaltwerk:session-added')).toBe(true)
        })

        // Prepare the background-start mark as if App.tsx had already claimed start authority.
        const sessionName = 'bg-marked'
        const topId = `session-${sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')}-top`
        markBackgroundStart(topId)
        expect(__debug_getBackgroundStartIds()).toContain(topId)

        const sessionAddedHandler = vi
            .mocked(listen)
            .mock.calls
            .reverse()
            .find(call => call[0] === 'schaltwerk:session-added')?.[1]
        expect(sessionAddedHandler).toBeDefined()

        await act(async () => {
            sessionAddedHandler?.({
                event: 'schaltwerk:session-added',
                id: 1002,
                payload: {
                    session_name: sessionName,
                    branch: 'feature/bg-marked',
                    worktree_path: '/tmp/bg2',
                    parent_branch: 'main',
                    created_at: '2025-09-20T12:34:56.000Z',
                    last_modified: '2025-09-20T12:34:56.000Z',
                }
            } as Event<unknown>)
        })

        // Because the mark existed, SessionsContext must NOT invoke StartClaude for this session.
        // We assert that no call was made with sessionName === 'bg-marked'
        const calls = vi.mocked(invoke).mock.calls.filter(
          ([cmd, args]) => cmd === TauriCommands.SchaltwerkCoreStartClaude && (args as { sessionName?: string })?.sessionName === sessionName
        )
        expect(calls.length).toBe(0)
    })
})
