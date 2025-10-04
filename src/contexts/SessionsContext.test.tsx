import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode, useEffect } from 'react'
import { SessionsProvider, useSessions } from './SessionsContext'
import { ProjectProvider, useProject } from './ProjectContext'
import { FilterMode, SortMode } from '../types/sessionFilters'
import type { Event } from '@tauri-apps/api/event'
import { SchaltEvent } from '../common/eventSystem'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(() => Promise.resolve(() => {})),
}))

const pushToastMock = vi.fn()

vi.mock('../common/toast/ToastProvider', () => ({
    useToast: () => ({ pushToast: pushToastMock, dismissToast: vi.fn() }),
    useOptionalToast: () => ({ pushToast: pushToastMock, dismissToast: vi.fn() })
}))

vi.mock('../common/agentSpawn', async () => {
    const actual = await vi.importActual<typeof import('../common/agentSpawn')>('../common/agentSpawn')
    return {
        ...actual,
        startSessionTop: vi.fn().mockResolvedValue(undefined),
        startOrchestratorTop: vi.fn().mockResolvedValue(undefined),
    }
})

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
            ready_to_merge: false,
            has_uncommitted_changes: false,
            has_conflicts: false,
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
            ready_to_merge: false,
            has_uncommitted_changes: true,
            has_conflicts: false,
            diff_stats: {
                files_changed: 2,
                additions: 10,
                deletions: 3,
                insertions: 10,
            }
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
            ready_to_merge: true,
            has_uncommitted_changes: false,
            has_conflicts: false,
            diff_stats: {
                files_changed: 0,
                additions: 0,
                deletions: 0,
                insertions: 0,
            }
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
        pushToastMock.mockReset()
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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

    it('derives merge status from reviewed session metadata during initial load', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('merged')
        expect(result.current.getMergeStatus('test-active')).toBe('idle')
    })

    it('should update session status from spec to active', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        let _callCount = 0
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            _callCount++
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return mockSessions
            if (cmd === TauriCommands.SchaltwerkCoreStartSpecSession) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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

    it('should mark merge status as conflict when git stats report conflicts', async () => {
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionGitStats]).toBeTruthy()
        })

        const emit = listeners[SchaltEvent.SessionGitStats]
        expect(emit).toBeDefined()

        act(() => {
            emit?.({
                event: SchaltEvent.SessionGitStats,
                id: 99,
                payload: {
                    session_id: 'test-ready',
                    session_name: 'test-ready',
                    files_changed: 2,
                    lines_added: 4,
                    lines_removed: 1,
                    has_uncommitted: true,
                    has_conflicts: true,
                }
            } as Event<unknown>)
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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

    it('marks merge status as conflict when preview reports conflicts', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                return {
                    sessionBranch: 'feature/test-ready',
                    parentBranch: 'main',
                    squashCommands: ['git reset --soft main', 'git commit -m "message"'],
                    reapplyCommands: ['git rebase main'],
                    defaultCommitMessage: 'Merge session test-ready into main',
                    hasConflicts: true,
                    conflictingPaths: ['conflict.txt'],
                    isUpToDate: false,
                }
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        await act(async () => {
            await result.current.openMergeDialog('test-ready')
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
    })

    it('marks merge status as merged when preview reports no commits', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                return {
                    sessionBranch: 'feature/test-ready',
                    parentBranch: 'main',
                    squashCommands: ['git reset --soft main', 'git commit -m "message"'],
                    reapplyCommands: ['git rebase main'],
                    defaultCommitMessage: 'Merge session test-ready into main',
                    hasConflicts: false,
                    conflictingPaths: [],
                    isUpToDate: true,
                }
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        await act(async () => {
            await result.current.openMergeDialog('test-ready')
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('merged')
    })

    it('marks merge status as conflict when git stats event signals merge conflict', async () => {
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionGitStats]).toBeTruthy()
        })

        act(() => {
            listeners[SchaltEvent.SessionGitStats]?.({
                event: SchaltEvent.SessionGitStats,
                id: 1,
                payload: {
                    session_id: 'test-ready',
                    session_name: 'test-ready',
                    files_changed: 0,
                    lines_added: 0,
                    lines_removed: 0,
                    has_uncommitted: false,
                    has_conflicts: false,
                    merge_has_conflicts: true,
                },
            } as unknown as Event<unknown>)
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
    })

    it('marks merge status as merged when git stats event signals up to date', async () => {
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionGitStats]).toBeTruthy()
        })

        act(() => {
            listeners[SchaltEvent.SessionGitStats]?.({
                event: SchaltEvent.SessionGitStats,
                id: 2,
                payload: {
                    session_id: 'test-ready',
                    session_name: 'test-ready',
                    files_changed: 1,
                    lines_added: 2,
                    lines_removed: 1,
                    has_uncommitted: true,
                    has_conflicts: false,
                    merge_has_conflicts: false,
                    merge_is_up_to_date: true,
                },
            } as unknown as Event<unknown>)
        })

        expect(result.current.getMergeStatus('test-ready')).toBe('merged')
    })

    it('prefetches merge preview for ready sessions on initial load', async () => {
        const previewResponse = {
            sessionBranch: 'feature/test-ready',
            parentBranch: 'main',
            squashCommands: [],
            reapplyCommands: [],
            defaultCommitMessage: 'Merge feature/test-ready',
            hasConflicts: true,
            conflictingPaths: ['src/foo.ts'],
            isUpToDate: false,
        }

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                expect(args).toEqual({ name: 'test-ready' })
                return previewResponse
            }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
        })

        expect(invoke).toHaveBeenCalledWith(
            TauriCommands.SchaltwerkCoreGetMergePreview,
            { name: 'test-ready' }
        )
    })

    it('prefetches merge preview when session becomes ready to merge after refresh', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        vi.mocked(listen).mockImplementation(async (event: string, handler: (event: Event<unknown>) => void) => {
            listeners[event] = handler
            return () => {}
        })

        const previewResponse = {
            sessionBranch: 'feature/test-active',
            parentBranch: 'main',
            squashCommands: [],
            reapplyCommands: [],
            defaultCommitMessage: 'Merge feature/test-active',
            hasConflicts: true,
            conflictingPaths: ['src/bar.ts'],
            isUpToDate: false,
        }

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                expect(args).toEqual({ name: 'test-active' })
                return previewResponse
            }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionsRefreshed]).toBeTruthy()
        })

        act(() => {
            listeners[SchaltEvent.SessionsRefreshed]?.({
                event: SchaltEvent.SessionsRefreshed,
                id: 3,
                payload: [
                    mockSessions[0],
                    {
                        ...mockSessions[1],
                        info: {
                            ...mockSessions[1].info,
                            ready_to_merge: true,
                            session_state: 'reviewed',
                        }
                    },
                    mockSessions[2],
                ],
            } as unknown as Event<unknown>)
        })

        await waitFor(() => {
            expect(result.current.getMergeStatus('test-active')).toBe('conflict')
        })

        expect(invoke).toHaveBeenCalledWith(
            TauriCommands.SchaltwerkCoreGetMergePreview,
            { name: 'test-active' }
        )
    })

    it('updates session state when a running session converts back to spec', async () => {
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionsRefreshed]).toBeTruthy()
        })

        const runningSession = mockSessions[1]
        const convertedToSpec = {
            ...runningSession,
            info: {
                ...runningSession.info,
                ready_to_merge: false,
                status: 'spec',
                session_state: 'spec',
            }
        }

        act(() => {
            listeners[SchaltEvent.SessionsRefreshed]?.({
                event: SchaltEvent.SessionsRefreshed,
                id: 4,
                payload: [mockSessions[0], convertedToSpec, mockSessions[2]],
            } as unknown as Event<unknown>)
        })

        await waitFor(() => {
            const session = result.current.allSessions.find(s => s.info.session_id === runningSession.info.session_id)
            expect(session?.info.session_state).toBe('spec')
            expect(session?.info.ready_to_merge).toBe(false)
        })
    })

    it('clears reviewed state when a reviewed session converts to spec', async () => {
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionsRefreshed]).toBeTruthy()
        })

        const reviewedSession = mockSessions[2]
        const convertedToSpec = {
            ...reviewedSession,
            info: {
                ...reviewedSession.info,
                ready_to_merge: false,
                status: 'spec',
                session_state: 'spec',
            }
        }

        act(() => {
            listeners[SchaltEvent.SessionsRefreshed]?.({
                event: SchaltEvent.SessionsRefreshed,
                id: 5,
                payload: [mockSessions[0], mockSessions[1], convertedToSpec],
            } as unknown as Event<unknown>)
        })

        await waitFor(() => {
            const session = result.current.allSessions.find(s => s.info.session_id === reviewedSession.info.session_id)
            expect(session?.info.session_state).toBe('spec')
            expect(session?.info.ready_to_merge).toBe(false)
        })

        act(() => {
            result.current.setFilterMode(FilterMode.Reviewed)
        })

        await waitFor(() => {
            expect(result.current.sessions.some(s => s.info.session_id === reviewedSession.info.session_id)).toBe(false)
        })
    })

    it('optimistically converts a running session to spec state', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        vi.mocked(listen).mockResolvedValue(() => {})

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.sessions.length).toBeGreaterThan(0)
        })

        act(() => {
            result.current.optimisticallyConvertSessionToSpec('test-active')
        })

        await waitFor(() => {
            const session = result.current.allSessions.find(s => s.info.session_id === 'test-active')
            expect(session?.info.session_state).toBe('spec')
            expect(session?.info.status).toBe('spec')
            expect(session?.info.ready_to_merge).toBe(false)
        })
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
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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

    it('reloads sessions when SessionsRefreshed payload is empty', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}

        vi.mocked(listen).mockImplementation(async (event: string, handler: (event: Event<unknown>) => void) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        const enrichedResponses = [
            mockSessions.filter(session => session.info.session_id !== 'test-spec'),
            mockSessions,
        ]
        let enrichedCallIndex = 0

        vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
            void args
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                const response = enrichedResponses[Math.min(enrichedCallIndex, enrichedResponses.length - 1)]
                enrichedCallIndex += 1
                return response
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all', sort_mode: 'name' }
            }
            if (cmd === TauriCommands.SetProjectSessionsSettings) {
                return undefined
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) {
                return { auto_cancel_after_merge: false }
            }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        const initialListCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions).length
        expect(initialListCalls).toBe(1)
        expect(result.current.sessions.some(session => session.info.session_id === 'test-spec')).toBe(false)

        await waitFor(() => {
            expect(listeners[SchaltEvent.SessionsRefreshed]).toBeTruthy()
        })

        act(() => {
            listeners[SchaltEvent.SessionsRefreshed]?.({
                event: SchaltEvent.SessionsRefreshed,
                id: 999,
                payload: [],
            } as unknown as Event<unknown>)
        })

        await waitFor(() => {
            const listCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions).length
            expect(listCalls).toBeGreaterThan(initialListCalls)
            expect(result.current.sessions.some(session => session.info.session_id === 'test-spec')).toBe(true)
        })
    })

    it('should keep creation sort order when SessionAdded fires', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'created' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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

    it('auto-starts new sessions via session agent helper', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const { startSessionTop } = await import('../common/agentSpawn')
        vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreStartSessionAgent) return 'started'
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
            expect(startSessionTop).toHaveBeenCalledWith(expect.objectContaining({
                sessionName: 'bg-new',
                topId: 'session-bg-new-top'
            }))
        })

    })

    it('auto-starts running sessions after sessions reload', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const { startSessionTop } = await import('../common/agentSpawn')

        vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(result.current.loading).toBe(false)
        })

        await waitFor(() => {
            expect(startSessionTop).toHaveBeenCalledWith(expect.objectContaining({
                sessionName: 'test-active',
                topId: 'session-test-active-top'
            }))
        })
    })

    it('skips auto-start when a background-start mark already exists', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: unknown) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.SchaltwerkCoreStartSessionAgent) return 'started'
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
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
          ([cmd, args]) => cmd === TauriCommands.SchaltwerkCoreStartSessionAgent && (args as { sessionName?: string })?.sessionName === sessionName
        )
        expect(calls.length).toBe(0)
    })

    it('deduplicates merge failure toasts per session', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        vi.mocked(listen).mockImplementation(async (event, handler) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await waitFor(() => {
            expect(listeners['schaltwerk:git-operation-failed']).toBeTruthy()
        })

        const failurePayload = {
            session_name: 'test-ready',
            session_branch: 'feature/test-ready',
            parent_branch: 'main',
            mode: 'squash',
            operation: 'merge',
            commit: null,
            status: 'conflict' as const,
            error: 'conflicts detected'
        }

        act(() => {
            listeners['schaltwerk:git-operation-failed']?.({
                event: 'schaltwerk:git-operation-failed',
                id: 1,
                payload: failurePayload
            } as Event<unknown>)
        })

        expect(pushToastMock).toHaveBeenCalledTimes(1)
        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')

        act(() => {
            listeners['schaltwerk:git-operation-failed']?.({
                event: 'schaltwerk:git-operation-failed',
                id: 2,
                payload: failurePayload
            } as Event<unknown>)
        })

        expect(pushToastMock).toHaveBeenCalledTimes(1)
        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
    })

    it('emits success toast and resets merge error cache', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        vi.mocked(listen).mockImplementation(async (event, handler) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: false }
            return undefined
        })

        const { result } = renderHook(() => useSessions(), { wrapper })

        await waitFor(() => {
            expect(listeners['schaltwerk:git-operation-completed']).toBeTruthy()
            expect(listeners['schaltwerk:git-operation-failed']).toBeTruthy()
        })

        act(() => {
            listeners['schaltwerk:git-operation-completed']?.({
                event: 'schaltwerk:git-operation-completed',
                id: 11,
                payload: {
                    session_name: 'test-ready',
                    session_branch: 'feature/test-ready',
                parent_branch: 'main',
                mode: 'reapply',
                operation: 'merge',
                commit: 'abcdef123456',
                status: 'success' as const
            }
        } as Event<unknown>)
        })

        expect(pushToastMock).toHaveBeenCalledTimes(1)
        expect(pushToastMock.mock.calls[0][0]).toMatchObject({ tone: 'success' })
        expect(result.current.getMergeStatus('test-ready')).toBe('merged')

        act(() => {
            listeners['schaltwerk:git-operation-failed']?.({
                event: 'schaltwerk:git-operation-failed',
                id: 12,
                payload: {
                    session_name: 'test-ready',
                    session_branch: 'feature/test-ready',
                    parent_branch: 'main',
                    mode: 'squash',
                    operation: 'merge',
                    commit: null,
                    status: 'conflict' as const,
                    error: 'merge failed'
                }
            } as Event<unknown>)
        })

        expect(pushToastMock).toHaveBeenCalledTimes(2)
        expect(pushToastMock.mock.calls[1][0]).toMatchObject({ tone: 'error' })
        expect(result.current.getMergeStatus('test-ready')).toBe('conflict')
    })

    it('auto-cancels session after successful merge when preference enabled', async () => {
        const { listen } = await import('@tauri-apps/api/event')
        const listeners: Record<string, (event: Event<unknown>) => void> = {}
        vi.mocked(listen).mockImplementation(async (event, handler) => {
            listeners[event] = handler
            return () => {}
        })

        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return mockSessions
            if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
            if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
            if (cmd === TauriCommands.GetProjectMergePreferences) return { auto_cancel_after_merge: true }
            if (cmd === TauriCommands.SchaltwerkCoreCancelSession) return undefined
            return undefined
        })

        renderHook(() => useSessions(), { wrapper: wrapperWithProject })

        await waitFor(() => {
            expect(listeners['schaltwerk:git-operation-completed']).toBeTruthy()
        })

        act(() => {
            listeners['schaltwerk:git-operation-completed']?.({
                event: 'schaltwerk:git-operation-completed',
                id: 21,
                payload: {
                    session_name: 'test-ready',
                    session_branch: 'feature/test-ready',
                    parent_branch: 'main',
                    mode: 'squash',
                    operation: 'merge',
                    commit: 'dcba987',
                    status: 'success' as const,
                }
            } as Event<unknown>)
        })

        await waitFor(() => {
            const cancelCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === TauriCommands.SchaltwerkCoreCancelSession)
            expect(cancelCalls.some(([, payload]) => (payload as { name?: string })?.name === 'test-ready')).toBe(true)
        })
    })
})
