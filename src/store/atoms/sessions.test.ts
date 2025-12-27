import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
        SessionGitStats: 'schaltwerk:session-git-stats',
        SessionAdded: 'schaltwerk:session-added',
        SessionRemoved: 'schaltwerk:session-removed',
        GitOperationStarted: 'schaltwerk:git-operation-started',
        GitOperationCompleted: 'schaltwerk:git-operation-completed',
        GitOperationFailed: 'schaltwerk:git-operation-failed',
        SessionActivity: 'schaltwerk:session-activity',
        TerminalAttention: 'schaltwerk:terminal-attention',
        TerminalAgentStarted: 'schaltwerk:terminal-agent-started',
    },
}))

vi.mock('../../common/agentSpawn', () => ({
    startSessionTop: vi.fn().mockResolvedValue(undefined),
    computeProjectOrchestratorId: vi.fn(() => 'orchestrator-test'),
}))

vi.mock('../../common/uiEvents', () => ({
    emitUiEvent: vi.fn(),
    UiEvent: {
        PermissionError: 'permission-error',
    },
}))

vi.mock('../../common/terminalStartState', () => ({
    isTerminalStartingOrStarted: vi.fn(() => false),
    markTerminalStarting: vi.fn(),
    markTerminalStarted: vi.fn(),
    clearTerminalStartState: vi.fn(),
}))

vi.mock('../../terminal/registry/terminalRegistry', () => ({
  acquireTerminalInstance: vi.fn(),
  releaseTerminalInstance: vi.fn(),
  removeTerminalInstance: vi.fn(),
  releaseSessionTerminals: vi.fn(),
}))

vi.mock('../../utils/singleflight', () => ({
    hasInflight: vi.fn(() => false),
    singleflight: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()),
    clearInflights: vi.fn(),
}))

vi.mock('../../utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

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
    cleanupProjectSessionsCacheActionAtom,
    expectSessionActionAtom,
} from './sessions'
import { projectPathAtom } from './project'
import { listenEvent as listenEventMock } from '../../common/eventSystem'
import { releaseSessionTerminals } from '../../terminal/registry/terminalRegistry'
import { startSessionTop } from '../../common/agentSpawn'
import { singleflight as singleflightMock } from '../../utils/singleflight'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { clearTerminalStartState } from '../../common/terminalStartState'
import { scopedSessionKey } from '../../common/scopeKeys'

const createSession = (overrides: Partial<EnrichedSession['info']>): EnrichedSession => ({
    info: {
        session_id: 'session-id',
        display_name: 'Session',
        branch: 'feature/session',
        worktree_path: '/tmp/session',
        base_branch: 'main',
        status: 'active',
        session_state: SessionState.Running,
        created_at: '2023-01-01T00:00:00.000Z',
        last_modified: '2023-01-02T00:00:00.000Z',
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

    const emitSessionsRefreshed = (sessions: EnrichedSession[] | null, projectPath?: string | null) => {
        const resolvedPath = projectPath ?? store.get(projectPathAtom) ?? null
        const payloadProjectPath = resolvedPath ?? ''
        listeners['schaltwerk:sessions-refreshed']?.({
            projectPath: payloadProjectPath,
            sessions: sessions ?? [],
        })
    }

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
        expect(store.get(filterModeAtom)).toBe(FilterMode.Running)
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

        // Default filter is Running, so sortedSessionsAtom shows only running sessions
        expect(store.get(sortedSessionsAtom).map(s => s.info.session_id)).toEqual([
            'running-b',
            'running-a',
        ])

        store.set(filterModeAtom, FilterMode.Spec)
        expect(store.get(filteredSessionsAtom).map(s => s.info.session_id)).toEqual(['spec-session'])

        store.set(filterModeAtom, FilterMode.Reviewed)
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

    it('keeps background project terminals alive across switches and releases when sessions truly disappear', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        let alphaSessionsPresent = true

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                const activeProject = store.get(projectPathAtom)
                if (activeProject === '/projects/alpha') {
                    return alphaSessionsPresent ? [createSession({ session_id: 'alpha-session' })] : []
                }
                if (activeProject === '/projects/beta') {
                    return [createSession({ session_id: 'beta-session' })]
                }
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/projects/alpha')
        await store.set(refreshSessionsActionAtom)
        expect(releaseSessionTerminals).not.toHaveBeenCalled()

        store.set(projectPathAtom, '/projects/beta')
        await store.set(refreshSessionsActionAtom)
        expect(releaseSessionTerminals).not.toHaveBeenCalled()

        alphaSessionsPresent = false
        store.set(projectPathAtom, '/projects/alpha')
        await store.set(refreshSessionsActionAtom)
        expect(releaseSessionTerminals).toHaveBeenCalledWith('alpha-session')
    })

    it('cleans up cached sessions when closing a background project', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                const activeProject = store.get(projectPathAtom)
                if (activeProject === '/projects/orphan') {
                    return [createSession({ session_id: 'orphan-session' })]
                }
                return [createSession({ session_id: 'active-session' })]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/projects/orphan')
        await store.set(refreshSessionsActionAtom)

        store.set(projectPathAtom, '/projects/active')
        await store.set(refreshSessionsActionAtom)
        vi.mocked(releaseSessionTerminals).mockClear()

        await store.set(cleanupProjectSessionsCacheActionAtom, '/projects/orphan')
        expect(releaseSessionTerminals).toHaveBeenCalledWith('orphan-session')
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

    it('skips auto-start for missing worktrees', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const missingSession = createSession({ session_id: 'missing-run', status: 'missing', session_state: 'running' })

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [missingSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        await store.set(refreshSessionsActionAtom)
        await Promise.resolve()
        await Promise.resolve()

        expect(startSessionTop).not.toHaveBeenCalled()
    })

    it('marks running sessions missing when auto-start fails due to missing worktree', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')

        const sessionId = 'missing-worktree'
        const runningSession = createSession({ session_id: sessionId, status: 'active', session_state: 'running' })

        vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [runningSession]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        vi.mocked(startSessionTop).mockRejectedValueOnce(
            new Error('Working directory not found: /tmp/missing'),
        )

        await store.set(refreshSessionsActionAtom)

        await vi.waitFor(() => {
            expect(startSessionTop).toHaveBeenCalledWith(expect.objectContaining({ sessionName: sessionId }))
        })

        await vi.waitFor(() => {
            const sessions = store.get(allSessionsAtom)
            expect(sessions[0]?.info.status).toBe('missing')
        })

        vi.mocked(startSessionTop).mockClear()

        await store.set(refreshSessionsActionAtom)

        await Promise.resolve()
        expect(startSessionTop).not.toHaveBeenCalled()
    })

    it('manages merge dialog lifecycle', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        vi.mocked(invoke).mockImplementation(async (cmd, args) => {
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreviewWithWorktree) {
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
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreviewWithWorktree) {
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
            if (cmd === TauriCommands.SchaltwerkCoreGetMergePreviewWithWorktree) {
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

    it('blocks the shortcut merge when the selection is a spec', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        store.set(allSessionsAtom, [createSession({ session_id: 'draft', session_state: SessionState.Spec, status: 'spec', ready_to_merge: false })])

        vi.mocked(invoke).mockImplementation(async () => undefined)

        const result = await store.set(shortcutMergeActionAtom, { sessionId: 'draft', commitMessage: null })
        expect(result).toEqual({ status: 'blocked', reason: 'not-ready' })
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

        store.set(projectPathAtom, '/project')
        store.set(enqueuePendingStartupActionAtom, { sessionId: 'alpha', agentType: 'codex' })
        expect(store.get(pendingStartupsAtom).get(scopedSessionKey('/project', 'alpha'))).toMatchObject({ agentType: 'codex' })

        store.set(clearPendingStartupActionAtom, 'alpha')
        expect(store.get(pendingStartupsAtom).has(scopedSessionKey('/project', 'alpha'))).toBe(false)

        store.set(enqueuePendingStartupActionAtom, { sessionId: 'beta', agentType: 'claude', ttlMs: 100 })
        vi.setSystemTime(now + 200)
        store.set(cleanupExpiredPendingStartupsActionAtom)
        expect(store.get(pendingStartupsAtom).has(scopedSessionKey('/project', 'beta'))).toBe(false)
    })

    it('initializes event listeners and responds to refresh events', async () => {
        await store.set(initializeSessionsEventsActionAtom)
        expect(Object.keys(listeners)).toContain('schaltwerk:sessions-refreshed')

        const payload = [
            createSession({ session_id: 'gamma' }),
            createSession({ session_id: 'delta' }),
        ]

        emitSessionsRefreshed(payload)
        expect(store.get(allSessionsAtom)).toEqual(payload)
    })

    it('skips queued background starts when the session becomes non-running before the queue drains', async () => {
        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)

        const payload = [
            createSession({ session_id: 'alpha', status: 'active', session_state: SessionState.Running }),
        ]

        emitSessionsRefreshed(payload)

        // Simulate the session becoming "processing" before the queued background start runs.
        store.set(allSessionsAtom, [
            createSession({ session_id: 'alpha', status: 'active', session_state: SessionState.Processing }),
        ])

        await Promise.resolve()
        expect(startSessionTop).not.toHaveBeenCalled()
    })

    it('updates session status via backend commands', async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        store.set(projectPathAtom, '/project')
        const sessionSnapshot = [
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
            if (cmd === TauriCommands.SchaltwerkCoreConvertSessionToDraft) {
                return 'running-draft'
            }
            return undefined
        })

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

    it('sets merge status to conflict when SessionGitStats reports local conflicts', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)

        const mergeSession = createSession({
            session_id: 'merge-session',
            ready_to_merge: true,
            merge_has_conflicts: false,
        })
        store.set(allSessionsAtom, [mergeSession])

        const statsListener = listeners['schaltwerk:session-git-stats']
        expect(statsListener).toBeTruthy()

        statsListener?.({
            session_name: 'merge-session',
            files_changed: 3,
            lines_added: 12,
            lines_removed: 1,
            has_uncommitted: false,
            merge_has_conflicts: true,
            merge_conflicting_paths: ['src/foo.ts'],
        })

        const updated = store.get(allSessionsAtom)[0]
        expect(updated.info.merge_has_conflicts).toBe(true)
        expect(updated.info.merge_conflicting_paths).toEqual(['src/foo.ts'])
        expect(store.get(mergeStatusSelectorAtom)('merge-session')).toBe('conflict')
    })

    it('does not release terminals when SessionsRefreshed fires with same sessions in different order', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [
                    createSession({ session_id: 'session-1', created_at: '2024-01-01T00:00:00.000Z' }),
                    createSession({ session_id: 'session-2', created_at: '2024-01-02T00:00:00.000Z' }),
                    createSession({ session_id: 'session-3', created_at: '2024-01-03T00:00:00.000Z' }),
                ]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)
        await store.set(refreshSessionsActionAtom)

        const initialSessionIds = store.get(allSessionsAtom).map(s => s.info.session_id).sort()
        expect(initialSessionIds).toEqual(['session-1', 'session-2', 'session-3'])

        vi.mocked(releaseSessionTerminals).mockClear()

        const reorderedSessions = [
            createSession({ session_id: 'session-2', created_at: '2024-01-02T00:00:00.000Z' }),
            createSession({ session_id: 'session-1', created_at: '2024-01-01T00:00:00.000Z' }),
            createSession({ session_id: 'session-3', created_at: '2024-01-03T00:00:00.000Z' }),
        ]

        emitSessionsRefreshed(reorderedSessions)

        expect(releaseSessionTerminals).not.toHaveBeenCalled()

        const finalSessionIds = store.get(allSessionsAtom).map(s => s.info.session_id).sort()
        expect(finalSessionIds).toEqual(['session-1', 'session-2', 'session-3'])
    })

    it('does not release terminals when dedupeSessions prefers spec over running state', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [createSession({ session_id: 'test-session', status: 'active', session_state: 'running' })]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return [{ name: 'test-session', id: 1, branch: 'specs/test-session', parent_branch: 'main', worktree_path: '', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' }]
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)
        await store.set(refreshSessionsActionAtom)

        expect(store.get(allSessionsAtom)).toHaveLength(1)
        expect(store.get(allSessionsAtom)[0]?.info.session_id).toBe('test-session')

        vi.mocked(releaseSessionTerminals).mockClear()

        emitSessionsRefreshed([
            createSession({ session_id: 'test-session', status: 'active', session_state: 'running' }),
        ])

        expect(releaseSessionTerminals).not.toHaveBeenCalledWith('test-session')
    })

    it('preserves an expected session when it is missing from a refresh snapshot', async () => {
        store.set(projectPathAtom, '/project')
        // Seed with a session and register expectation
        const session = createSession({ session_id: 'volatile-session' })
        store.set(allSessionsAtom, [session])
        await store.set(initializeSessionsEventsActionAtom)
        store.set(expectSessionActionAtom, 'volatile-session')

        vi.mocked(releaseSessionTerminals).mockClear()

        emitSessionsRefreshed([])

        expect(releaseSessionTerminals).not.toHaveBeenCalled()
        expect(store.get(allSessionsAtom)).toHaveLength(1)
        expect(store.get(allSessionsAtom)[0].info.session_id).toBe('volatile-session')
    })

    it('does not release terminals when SessionsRefreshed payload targets another project', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                const activeProject = store.get(projectPathAtom)
                if (activeProject === '/projects/alpha') {
                    return [createSession({ session_id: 'alpha-session' })]
                }
                if (activeProject === '/projects/beta') {
                    return [createSession({ session_id: 'beta-session' })]
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/projects/alpha')
        await store.set(refreshSessionsActionAtom)
        expect(store.get(allSessionsAtom).map(session => session.info.session_id)).toEqual(['alpha-session'])

        vi.mocked(releaseSessionTerminals).mockClear()

        emitSessionsRefreshed([
            createSession({ session_id: 'beta-session', created_at: '2024-01-05T00:00:00.000Z' }),
        ], '/projects/beta')

        expect(releaseSessionTerminals).not.toHaveBeenCalled()
        expect(store.get(allSessionsAtom).map(session => session.info.session_id)).toEqual(['alpha-session'])
    })

    it('ignores GitOperationCompleted for unknown sessions', async () => {
        await store.set(initializeSessionsEventsActionAtom)

        listeners['schaltwerk:git-operation-completed']?.({
            session_name: 'ghost',
            parent_branch: 'main',
            operation: 'merge',
            status: 'success',
            commit: 'abcdef1',
        })

        expect(store.get(mergeStatusSelectorAtom)('ghost')).toBeUndefined()
    })

    it('ignores SessionGitStats for unknown sessions', async () => {
        await store.set(initializeSessionsEventsActionAtom)
        expect(store.get(allSessionsAtom)).toEqual([])

        listeners['schaltwerk:session-git-stats']?.({
            session_name: 'ghost',
            files_changed: 1,
            lines_added: 10,
            lines_removed: 1,
        })

        expect(store.get(allSessionsAtom)).toEqual([])
    })

    it('ignores SessionActivity for unknown sessions', async () => {
        await store.set(initializeSessionsEventsActionAtom)
        expect(store.get(allSessionsAtom)).toEqual([])

        listeners['schaltwerk:session-activity']?.({
            session_name: 'ghost',
            last_activity_ts: Date.now() / 1000,
            current_task: 'noop',
        })

        expect(store.get(allSessionsAtom)).toEqual([])
    })

    it('ignores TerminalAttention for unknown sessions', async () => {
        await store.set(initializeSessionsEventsActionAtom)
        expect(store.get(allSessionsAtom)).toEqual([])

        listeners['schaltwerk:terminal-attention']?.({
            session_id: 'ghost',
            terminal_id: 'session-ghost-top',
            needs_attention: true,
        })

        expect(store.get(allSessionsAtom)).toEqual([])
    })

    it('ignores late snapshot from a previous project during rapid switches', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        let resolveAlpha: ((value: EnrichedSession[]) => void) | undefined
        let callCount = 0

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                callCount += 1
                if (callCount === 1) {
                    return new Promise<EnrichedSession[]>(resolve => { resolveAlpha = resolve })
                }
                if (callCount === 2) {
                    return [createSession({ session_id: 'beta-session', worktree_path: '/tmp/beta' })]
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/projects/alpha')
        const alphaRefreshPromise = store.set(refreshSessionsActionAtom)

        store.set(projectPathAtom, '/projects/beta')
        await store.set(refreshSessionsActionAtom)

        expect(store.get(allSessionsAtom).map(s => s.info.session_id)).toEqual(['beta-session'])

        resolveAlpha?.([createSession({ session_id: 'alpha-session', worktree_path: '/tmp/alpha' })])
        await alphaRefreshPromise

        expect(store.get(allSessionsAtom).map(s => s.info.session_id)).toEqual(['beta-session'])
    })

    it('scopes expected sessions to the active project when reinjecting snapshots', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                const activeProject = store.get(projectPathAtom)
                if (activeProject === '/projects/alpha') {
                    return [createSession({ session_id: 'alpha-session', worktree_path: '/tmp/alpha' })]
                }
                if (activeProject === '/projects/beta') {
                    return [createSession({ session_id: 'beta-session', worktree_path: '/tmp/beta' })]
                }
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/projects/alpha')
        await store.set(refreshSessionsActionAtom)

        const optimisticAlpha = createSession({ session_id: 'alpha-optimistic', worktree_path: '/tmp/alpha-optimistic' })
        store.set(expectSessionActionAtom, optimisticAlpha)

        store.set(projectPathAtom, '/projects/beta')
        await store.set(refreshSessionsActionAtom)

        const betaIds = store.get(allSessionsAtom).map(session => session.info.session_id)
        expect(betaIds).toEqual(['beta-session'])

        store.set(projectPathAtom, '/projects/alpha')
        await store.set(refreshSessionsActionAtom)

        const alphaIds = store.get(allSessionsAtom).map(session => session.info.session_id)
        expect(alphaIds).toEqual(expect.arrayContaining(['alpha-session', 'alpha-optimistic']))
    })

    it('REPRO: does not release first session terminals when projectPath cache is stale', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [
                    createSession({ session_id: 'first-session', created_at: '2024-01-03T00:00:00.000Z' }),
                    createSession({ session_id: 'second-session', created_at: '2024-01-02T00:00:00.000Z' }),
                ]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/project-alpha')
        await store.set(initializeSessionsEventsActionAtom)
        await store.set(refreshSessionsActionAtom)

        expect(store.get(allSessionsAtom).map(s => s.info.session_id)).toContain('first-session')

        vi.mocked(releaseSessionTerminals).mockClear()

        store.set(projectPathAtom, null)
        store.set(projectPathAtom, '/project-alpha')

        emitSessionsRefreshed([
            createSession({ session_id: 'first-session', created_at: '2024-01-03T00:00:00.000Z' }),
            createSession({ session_id: 'second-session', created_at: '2024-01-02T00:00:00.000Z' }),
        ])

        expect(releaseSessionTerminals).not.toHaveBeenCalledWith('first-session')
        expect(releaseSessionTerminals).not.toHaveBeenCalledWith('second-session')
    })

    it('does not restart existing running sessions when SessionsRefreshed fires after SessionAdded', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [
                    createSession({ session_id: 'session-a', status: 'active', session_state: 'running' }),
                ]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            if (cmd === TauriCommands.SchaltwerkCoreGetSession) {
                return {
                    name: 'session-b',
                    branch: 'schaltwerk/session-b',
                    worktree_path: '/tmp/session-b',
                }
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)
        await store.set(refreshSessionsActionAtom)

        await vi.waitFor(() => {
            expect(vi.mocked(startSessionTop).mock.calls.some(call => call[0]?.sessionName === 'session-a')).toBe(true)
        })

        expect(store.get(allSessionsAtom)).toHaveLength(1)
        expect(store.get(allSessionsAtom)[0]?.info.session_id).toBe('session-a')

        vi.mocked(startSessionTop).mockClear()

        listeners['schaltwerk:session-added']?.({
            session_name: 'session-b',
            created_at: '2024-01-01T00:05:00.000Z',
            last_modified: '2024-01-01T00:05:00.000Z',
        })

        await vi.waitFor(() => {
            expect(store.get(allSessionsAtom)).toHaveLength(2)
        })

        await vi.waitFor(() => {
            const sessionBStartCalls = vi.mocked(startSessionTop).mock.calls.filter(
                call => call[0]?.sessionName === 'session-b'
            )
            expect(sessionBStartCalls).toHaveLength(1)
        })

        vi.mocked(startSessionTop).mockClear()

        emitSessionsRefreshed([
            createSession({ session_id: 'session-a', status: 'active', session_state: 'running' }),
            createSession({ session_id: 'session-b', status: 'active', session_state: 'running' }),
        ])

        await vi.waitFor(() => {
            const allSessions = store.get(allSessionsAtom)
            expect(allSessions.some(s => s.info.session_id === 'session-a')).toBe(true)
            expect(allSessions.some(s => s.info.session_id === 'session-b')).toBe(true)
        })

        const sessionARestartCalls = vi.mocked(startSessionTop).mock.calls.filter(
            call => call[0]?.sessionName === 'session-a'
        )
        expect(sessionARestartCalls).toHaveLength(0)

        const sessionBRestartCalls = vi.mocked(startSessionTop).mock.calls.filter(
            call => call[0]?.sessionName === 'session-b'
        )
        expect(sessionBRestartCalls).toHaveLength(0)
    })

    it('clears terminal start state when SessionRemoved fires to allow session recreation with same name', async () => {
        const { invoke } = await import('@tauri-apps/api/core')

        vi.mocked(invoke).mockImplementation(async (cmd) => {
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
                return [
                    createSession({ session_id: 'reusable-session', status: 'active', session_state: 'running' }),
                ]
            }
            if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) {
                return []
            }
            return undefined
        })

        store.set(projectPathAtom, '/project')
        await store.set(initializeSessionsEventsActionAtom)
        await store.set(refreshSessionsActionAtom)

        expect(store.get(allSessionsAtom)).toHaveLength(1)
        expect(store.get(allSessionsAtom)[0]?.info.session_id).toBe('reusable-session')

        vi.mocked(clearTerminalStartState).mockClear()
        vi.mocked(releaseSessionTerminals).mockClear()

        listeners['schaltwerk:session-removed']?.({
            session_name: 'reusable-session',
        })

        expect(store.get(allSessionsAtom)).toHaveLength(0)
        expect(releaseSessionTerminals).toHaveBeenCalledWith('reusable-session')

        const expectedTopId = stableSessionTerminalId('reusable-session', 'top')
        const expectedBottomId = stableSessionTerminalId('reusable-session', 'bottom')
        expect(clearTerminalStartState).toHaveBeenCalledWith([expectedTopId, expectedBottomId], 'orchestrator-test')
    })
})
