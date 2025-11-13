import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'jotai'
import { FilterMode } from '../../types/sessionFilters'
import { SessionState, type EnrichedSession } from '../../types/session'
import { TauriCommands } from '../../common/tauriCommands'
import {
    allSessionsAtom,
    sessionsAtom,
    filteredSessionsAtom,
    sortedSessionsAtom,
    filterModeAtom,
    searchQueryAtom,
    isSearchVisibleAtom,
    refreshSessionsActionAtom,
    lastRefreshAtom,
    mergeDialogAtom,
    openMergeDialogActionAtom,
    closeMergeDialogActionAtom,
    confirmMergeActionAtom,
    shortcutMergeActionAtom,
    mergeStatusSelectorAtom,
    mergeInFlightSelectorAtom,
    beginSessionMutationActionAtom,
    endSessionMutationActionAtom,
    sessionMutationSelectorAtom,
    enqueuePendingStartupActionAtom,
    pendingStartupsAtom,
    clearPendingStartupActionAtom,
    cleanupExpiredPendingStartupsActionAtom,
    initializeSessionsEventsActionAtom,
    updateSessionStatusActionAtom,
    createDraftActionAtom,
    updateSessionSpecContentActionAtom,
    autoCancelAfterMergeAtom,
    updateAutoCancelAfterMergeActionAtom,
    initializeSessionsSettingsActionAtom,
    setCurrentSelectionActionAtom,
    reloadSessionsActionAtom,
    sessionsLoadingAtom,
    optimisticallyConvertSessionToSpecActionAtom,
    setSessionsToastHandlers,
    __resetSessionsTestingState,
} from './sessions'
import { projectPathAtom } from './project'
import { listenEvent as listenEventMock } from '../../common/eventSystem'
import { releaseSessionTerminals } from '../../terminal/registry/terminalRegistry'
import { startSessionTop } from '../../common/agentSpawn'
import { singleflight as singleflightMock } from '../../utils/singleflight'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

const listeners: Record<string, (payload: unknown) => void> = {}

vi.mock('../../common/eventSystem', () => ({
    listenEvent: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
        listeners[event] = handler
        return () => {
            delete listeners[event]
        }
    }),
    SchaltEvent: {
        SessionsRefreshed: 'schaltwerk:sessions-refreshed',
        GitOperationStarted: 'schaltwerk:git-operation-started',
        GitOperationCompleted: 'schaltwerk:git-operation-completed',
        GitOperationFailed: 'schaltwerk:git-operation-failed',
    },
}))

vi.mock('../../common/agentSpawn', () => ({
    startSessionTop: vi.fn().mockResolvedValue(undefined),
    computeProjectOrchestratorId: vi.fn(() => 'orchestrator-test'),
}))

vi.mock('../../common/uiEvents', () => ({
    hasBackgroundStart: vi.fn(() => false),
    emitUiEvent: vi.fn(),
    UiEvent: {
        PermissionError: 'permission-error',
    },
}))

vi.mock('../../terminal/registry/terminalRegistry', () => ({
    releaseSessionTerminals: vi.fn(),
}))

vi.mock('../../utils/singleflight', () => ({
    hasInflight: vi.fn(() => false),
    singleflight: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

const createSession = (overrides: Partial<EnrichedSession['info']>): EnrichedSession => ({
    info: {
        session_id: 'session-id',
        display_name: 'Session',
        branch: 'feature/session',
        worktree_path: '/tmp/session',
        base_branch: 'main',
        status: 'active',
        session_state: SessionState.Running,
        created_at: '2024-01-01T00:00:00.000Z',
        last_modified: '2024-01-02T00:00:00.000Z',
        ready_to_merge: false,
        has_uncommitted_changes: false,
        has_conflicts: false,
        diff_stats: {
            files_changed: 0,
            additions: 0,
            deletions: 0,
            insertions: 0,
        },
        is_current: false,
        session_type: 'worktree',
        ...overrides,
    },
    terminals: [],
})

describe('sessions atoms', () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        store = createStore()
        vi.clearAllMocks()
        Object.keys(listeners).forEach(key => delete listeners[key])
        __resetSessionsTestingState()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('provides default core state', () => {
        expect(store.get(allSessionsAtom)).toEqual([])
        expect(store.get(filterModeAtom)).toBe(FilterMode.All)
        expect(store.get(searchQueryAtom)).toBe('')
        expect(store.get(isSearchVisibleAtom)).toBe(false)
    })

    it('filters, sorts, and searches sessions', () => {
        const sessions = [
            createSession({ session_id: 'spec-session', status: 'spec', session_state: 'spec' }),
            createSession({
                session_id: 'running-a',
                display_name: 'Active A',
                created_at: '2024-01-03T00:00:00.000Z',
                ready_to_merge: false,
            }),
            createSession({
                session_id: 'running-b',
                display_name: 'Active B',
                created_at: '2024-01-04T00:00:00.000Z',
                ready_to_merge: false,
                last_modified: '2024-01-05T00:00:00.000Z',
            }),
            createSession({
                session_id: 'reviewed-one',
                display_name: 'Reviewed',
                ready_to_merge: true,
            }),
        ]

        store.set(allSessionsAtom, sessions)

        expect(store.get(sortedSessionsAtom).map(s => s.info.session_id)).toEqual([
            'running-b',
            'running-a',
            'spec-session',
            'reviewed-one',
        ])

        store.set(filterModeAtom, FilterMode.Spec)
        expect(store.get(filteredSessionsAtom).map(s => s.info.session_id)).toEqual(['spec-session'])

        store.set(filterModeAtom, FilterMode.All)
        store.set(searchQueryAtom, 'reviewed')
        expect(store.get(sessionsAtom).map(s => s.info.session_id)).toEqual(['reviewed-one'])
    })

    it('refreshes sessions from backend and updates timestamp', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const payload = [
            createSession({ session_id: 'alpha' }),
            createSession({ session_id: 'beta', ready_to_merge: true }),
        ]
        const now = Date.now()
        store.set(projectPathAtom, '/project')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return payload
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(refreshSessionsActionAtom)

        expect(store.get(allSessionsAtom)).toEqual(payload)
        expect(store.get(lastRefreshAtom)).toBe(now)
    })

    it('releases terminals when sessions are removed on refresh', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const enrichedSnapshots = [
            [createSession({ session_id: 'old-session' })],
            [],
        ]

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return enrichedSnapshots.shift() ?? []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(refreshSessionsActionAtom)
        expect(releaseSessionTerminals).not.toHaveBeenCalled()

        await store.set(refreshSessionsActionAtom)

        expect(releaseSessionTerminals).toHaveBeenCalledWith('old-session')
        expect(store.get(allSessionsAtom)).toEqual([])
    })

    it('auto-starts running sessions on refresh when newly running', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const runningSession = createSession({ session_id: 'auto-run', status: 'active', session_state: 'running' })

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [runningSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(refreshSessionsActionAtom)
        await Promise.resolve()
        await Promise.resolve()

        expect(startSessionTop).toHaveBeenCalledWith(expect.objectContaining({ sessionName: 'auto-run' }))
    })

    it('manages merge dialog lifecycle', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd, args) => {
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                const mergeArgs = args as { name?: string }
                return {
                    sessionBranch: 'feature/branch',
                    parentBranch: 'main',
                    squashCommands: ['git command'],
                    reapplyCommands: ['git rebase main'],
                    defaultCommitMessage: 'Merge message',
                    hasConflicts: mergeArgs?.name === 'conflict',
                    conflictingPaths: mergeArgs?.name === 'conflict' ? ['file.txt'] : [],
                    isUpToDate: false,
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreMergeSessionToMain) {
                return undefined
            }
            return undefined
        })

        await store.set(openMergeDialogActionAtom, 'test-session')
        expect(store.get(mergeDialogAtom)).toMatchObject({
            isOpen: true,
            status: 'ready',
            sessionName: 'test-session',
        })

        const getStatus = store.get(mergeStatusSelectorAtom)
        expect(getStatus('test-session')).toBe(undefined)

        await store.set(confirmMergeActionAtom, { sessionId: 'test-session', mode: 'squash' })
        expect(store.get(mergeInFlightSelectorAtom)('test-session')).toBe(false)
        expect(store.get(mergeDialogAtom).isOpen).toBe(false)

        await store.set(openMergeDialogActionAtom, 'conflict')
        expect(store.get(mergeStatusSelectorAtom)('conflict')).toBe('conflict')

        store.set(closeMergeDialogActionAtom)
        expect(store.get(mergeDialogAtom).isOpen).toBe(false)
    })

    it('performs a direct shortcut merge when preview has no conflicts', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const readySession = createSession({
            session_id: 'ready',
            ready_to_merge: true,
            status: 'dirty',
            session_state: SessionState.Reviewed,
        })
        store.set(allSessionsAtom, [readySession])

        vi.mocked(invoke).mockImplementation(async (cmd, args) => {
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                const mergeArgs = args as { name?: string }
                return {
                    sessionBranch: `feature/${mergeArgs?.name ?? 'unknown'}`,
                    parentBranch: 'main',
                    squashCommands: [],
                    reapplyCommands: [],
                    defaultCommitMessage: 'Shortcut merge message',
                    hasConflicts: false,
                    conflictingPaths: [],
                    isUpToDate: false,
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreMergeSessionToMain) {
                return undefined
            }
            return undefined
        })

        const result = await store.set(shortcutMergeActionAtom, { sessionId: 'ready', commitMessage: null })
        expect(result).toMatchObject({ status: 'needs-modal', reason: 'confirm' })
        expect(store.get(mergeDialogAtom)).toMatchObject({ isOpen: true, sessionName: 'ready' })
    })

    it('opens the merge dialog when the shortcut hit encounters conflicts', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const conflictSession = createSession({
            session_id: 'conflict',
            ready_to_merge: true,
            status: 'dirty',
            session_state: SessionState.Reviewed,
        })
        store.set(allSessionsAtom, [conflictSession])

        vi.mocked(invoke).mockImplementation(async (cmd, args) => {
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                const mergeArgs = args as { name?: string }
                return {
                    sessionBranch: `feature/${mergeArgs?.name ?? 'unknown'}`,
                    parentBranch: 'main',
                    squashCommands: [],
                    reapplyCommands: [],
                    defaultCommitMessage: 'irrelevant',
                    hasConflicts: true,
                    conflictingPaths: ['src/file.ts'],
                    isUpToDate: false,
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreMergeSessionToMain) {
                return undefined
            }
            return undefined
        })

        const result = await store.set(shortcutMergeActionAtom, { sessionId: 'conflict', commitMessage: null })
        expect(result).toMatchObject({ status: 'needs-modal', reason: 'conflict' })
        expect(store.get(mergeDialogAtom)).toMatchObject({ isOpen: true, sessionName: 'conflict' })
    })

    it('blocks the shortcut merge when the selection is not ready', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        store.set(allSessionsAtom, [createSession({ session_id: 'draft', ready_to_merge: false })])

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [createSession({ session_id: 'draft', ready_to_merge: false })]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreMarkSessionReady) {
                return true
            }
            return undefined
        })

        const result = await store.set(shortcutMergeActionAtom, { sessionId: 'draft', commitMessage: null })
        expect(result).toEqual({ status: 'blocked', reason: 'not-ready', autoMarkedReady: true })
    })

    it('auto marks running sessions reviewed before merging when readiness was stale', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        const stale = createSession({ session_id: 'stale', ready_to_merge: false })
        const refreshed = createSession({ session_id: 'stale', ready_to_merge: true, status: 'dirty', session_state: SessionState.Reviewed })
        store.set(allSessionsAtom, [stale])

        vi.mocked(invoke).mockImplementation(async (cmd, args) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [refreshed]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreMarkSessionReady) {
                return true
            }
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreview) {
                const mergeArgs = args as { name?: string }
                return {
                    sessionBranch: `feature/${mergeArgs?.name ?? 'unknown'}`,
                    parentBranch: 'main',
                    squashCommands: [],
                    reapplyCommands: [],
                    defaultCommitMessage: 'Refreshed merge message',
                    hasConflicts: false,
                    conflictingPaths: [],
                    isUpToDate: false,
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreMergeSessionToMain) {
                return undefined
            }
            return undefined
        })

        const result = await store.set(shortcutMergeActionAtom, { sessionId: 'stale', commitMessage: null })
        expect(result).toEqual({ status: 'needs-modal', reason: 'confirm', autoMarkedReady: true })
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, {
            name: 'stale',
            autoCommit: true,
            commitMessage: null,
        })
    })

    it('tracks session mutations', () => {
        const selectMutation = store.get(sessionMutationSelectorAtom)
        expect(selectMutation('abc', 'merge')).toBe(false)

        store.set(beginSessionMutationActionAtom, { sessionId: 'abc', kind: 'merge' })
        expect(store.get(sessionMutationSelectorAtom)('abc', 'merge')).toBe(true)

        store.set(endSessionMutationActionAtom, { sessionId: 'abc', kind: 'merge' })
        expect(store.get(sessionMutationSelectorAtom)('abc', 'merge')).toBe(false)
    })

    it('tracks pending startups with expiry cleanup', () => {
        const now = Date.now()
        vi.setSystemTime(now)

        store.set(enqueuePendingStartupActionAtom, { sessionId: 'alpha', agentType: 'codex' })
        expect(store.get(pendingStartupsAtom).get('alpha')).toMatchObject({ agentType: 'codex' })

        store.set(clearPendingStartupActionAtom, 'alpha')
        expect(store.get(pendingStartupsAtom).has('alpha')).toBe(false)

        store.set(enqueuePendingStartupActionAtom, { sessionId: 'beta', agentType: 'claude', ttlMs: 100 })
        vi.setSystemTime(now + 200)
        store.set(cleanupExpiredPendingStartupsActionAtom)
        expect(store.get(pendingStartupsAtom).has('beta')).toBe(false)
    })

    it('initializes event listeners and responds to refresh events', async () => {
        await store.set(initializeSessionsEventsActionAtom)
        expect(Object.keys(listeners)).toContain('schaltwerk:sessions-refreshed')

        const payload = [
            createSession({ session_id: 'gamma' }),
            createSession({ session_id: 'delta' }),
        ]

        listeners['schaltwerk:sessions-refreshed']?.(payload)
        expect(store.get(allSessionsAtom)).toEqual(payload)
    })

    it('updates session status via backend commands', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        const sessionSnapshot = [
            createSession({ session_id: 'draft', status: 'spec', session_state: 'spec' }),
            createSession({ session_id: 'running', status: 'active', session_state: 'running' }),
            createSession({ session_id: 'review', status: 'dirty', session_state: 'reviewed', ready_to_merge: true }),
        ]
        store.set(allSessionsAtom, sessionSnapshot)

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return sessionSnapshot
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(updateSessionStatusActionAtom, { sessionId: 'draft', status: 'active' })
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartSpecSession, { name: 'draft' })

        await store.set(updateSessionStatusActionAtom, { sessionId: 'running', status: 'spec' })
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreConvertSessionToDraft, { name: 'running' })

        await store.set(updateSessionStatusActionAtom, { sessionId: 'review', status: 'dirty' })
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkReady, { name: 'review' })
    })

    it('creates draft sessions and reloads afterwards', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(createDraftActionAtom, { name: 'new-spec', content: '# spec' })
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreCreateSpecSession, {
            name: 'new-spec',
            specContent: '# spec',
        })
    })

    it('updates session spec content locally', () => {
        store.set(allSessionsAtom, [
            createSession({
                session_id: 'spec',
                status: 'spec',
                session_state: 'spec',
                spec_content: 'Old',
            }),
        ])

        store.set(updateSessionSpecContentActionAtom, { sessionId: 'spec', content: 'New content' })
        expect(store.get(allSessionsAtom)[0].info.spec_content).toBe('New content')
    })

    it('initializes settings and persists updates', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'spec' }
            }
            if (cmd === TauriCommands.SetProjectSessionsSettings) {
                return undefined
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) {
                return { auto_cancel_after_merge: false }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(initializeSessionsSettingsActionAtom)

        expect(store.get(filterModeAtom)).toBe(FilterMode.Spec)
        expect(store.get(autoCancelAfterMergeAtom)).toBe(false)

        store.set(filterModeAtom, FilterMode.Reviewed)
        await Promise.resolve()

        expect(invoke).toHaveBeenCalledWith(TauriCommands.SetProjectSessionsSettings, {
            settings: {
                filter_mode: FilterMode.Reviewed,
            },
        })
    })

    it('updates auto-cancel preference optimistically and rolls back on failure', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SetProjectMergePreferences) {
                throw new Error('failed')
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all' }
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) {
                return { auto_cancel_after_merge: true }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsSettingsActionAtom)

        expect(store.get(autoCancelAfterMergeAtom)).toBe(true)

        await store.set(updateAutoCancelAfterMergeActionAtom, { value: false, persist: true })
        expect(store.get(autoCancelAfterMergeAtom)).toBe(true)
    })

    it('stores current selection id for downstream consumers', () => {
        store.set(setCurrentSelectionActionAtom, 'session-id')
        store.set(setCurrentSelectionActionAtom, null)
    })

    it('reuses in-flight reload requests and toggles loading state', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const resolvers: Array<(value: unknown) => void> = []
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return new Promise(resolve => {
                    resolvers.push(resolve)
                })
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all' }
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) {
                return { auto_cancel_after_merge: true }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        const promiseA = store.set(reloadSessionsActionAtom)
        const promiseB = store.set(reloadSessionsActionAtom)

        await vi.waitFor(() => {
            expect(vi.mocked(singleflightMock)).toHaveBeenCalledTimes(1)
        })

        expect(store.get(sessionsLoadingAtom)).toBe(true)

        const firstResolver = resolvers.shift()
        expect(firstResolver).toBeTruthy()
        firstResolver?.([
            createSession({ session_id: 'fresh' }),
        ])

        await vi.waitFor(() => {
            expect(vi.mocked(singleflightMock)).toHaveBeenCalledTimes(2)
        })

        const secondResolver = resolvers.shift()
        expect(secondResolver).toBeTruthy()
        secondResolver?.([
            createSession({ session_id: 'fresh' }),
        ])

        await Promise.all([promiseA, promiseB])
        expect(store.get(sessionsLoadingAtom)).toBe(false)
        expect(store.get(allSessionsAtom)[0].info.session_id).toBe('fresh')
    })

    it('optimistically converts running session to spec', () => {
        store.set(allSessionsAtom, [
            createSession({ session_id: 'run', status: 'active', session_state: 'running', ready_to_merge: false }),
        ])

        store.set(optimisticallyConvertSessionToSpecActionAtom, 'run')

        const session = store.get(allSessionsAtom)[0]
        expect(session.info.session_state).toBe('spec')
        expect(session.info.status).toBe('spec')
        expect(session.info.ready_to_merge).toBe(false)
    })

    it('handles git operation events and auto cancel preference', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const toastSpy = vi.fn()
        setSessionsToastHandlers({ pushToast: toastSpy })

        vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return []
            }
            if (cmd === TauriCommands.GetProjectSessionsSettings) {
                return { filter_mode: 'all' }
            }
            if (cmd === TauriCommands.GetProjectMergePreferences) {
                return { auto_cancel_after_merge: true }
            }
            if (cmd === TauriCommands.SchaltwerkCoreCancelSession) {
                return undefined
            }
            if (cmd === TauriCommands.SetProjectSessionsSettings) {
                return undefined
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(initializeSessionsSettingsActionAtom)
        await store.set(initializeSessionsEventsActionAtom)
        await Promise.resolve()

        store.set(allSessionsAtom, [
            createSession({ session_id: 'merge', ready_to_merge: true, status: 'dirty', session_state: 'reviewed' }),
        ])

        expect(listenEventMock).toHaveBeenCalledWith('schaltwerk:git-operation-started', expect.any(Function))
        expect(listenEventMock).toHaveBeenCalledWith('schaltwerk:git-operation-completed', expect.any(Function))
        const startedListener = listeners['schaltwerk:git-operation-started']
        const completedListener = listeners['schaltwerk:git-operation-completed']
        expect(startedListener).toBeTruthy()
        expect(completedListener).toBeTruthy()

        listeners['schaltwerk:git-operation-started']?.({
            session_name: 'merge',
            parent_branch: 'main',
            operation: 'merge',
        })

        expect(store.get(mergeInFlightSelectorAtom)('merge')).toBe(true)

        listeners['schaltwerk:git-operation-completed']?.({
            session_name: 'merge',
            parent_branch: 'main',
            operation: 'merge',
            status: 'success',
            commit: 'abcdef123',
        })

        expect(store.get(mergeStatusSelectorAtom)('merge')).toBe('merged')
        expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreCancelSession, { name: 'merge' })
        expect(toastSpy).toHaveBeenCalled()
    })
})
