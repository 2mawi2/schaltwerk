import { atom } from 'jotai'
import type { Getter, Setter } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import type { EnrichedSession, AgentType } from '../../types/session'
import { FilterMode, getDefaultFilterMode, isValidFilterMode } from '../../types/sessionFilters'
import { TauriCommands } from '../../common/tauriCommands'
import { mapSessionUiState, searchSessions as searchSessionsUtil } from '../../utils/sessionFilters'
import { SessionState, type RawSession, type SessionInfo } from '../../types/session'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { projectPathAtom } from './project'
import { setSelectionFilterModeActionAtom } from './selection'
import type { GitOperationFailedPayload, GitOperationPayload, SessionsRefreshedEventPayload } from '../../common/events'
import { hasInflight, singleflight } from '../../utils/singleflight'
import { stableSessionTerminalId, isTopTerminalId } from '../../common/terminalIdentity'
import { hasBackgroundStart, emitUiEvent, UiEvent } from '../../common/uiEvents'
import { startSessionTop, computeProjectOrchestratorId } from '../../common/agentSpawn'
import { releaseSessionTerminals } from '../../terminal/registry/terminalRegistry'
import { logger } from '../../utils/logger'

type MergeModeOption = 'squash' | 'reapply'

export type MergeStatus = 'idle' | 'conflict' | 'merged'

interface MergePreviewResponse {
    sessionBranch: string
    parentBranch: string
    squashCommands: string[]
    reapplyCommands: string[]
    defaultCommitMessage: string
    hasConflicts: boolean
    conflictingPaths: string[]
    isUpToDate: boolean
}

type MergeDialogStatus = 'idle' | 'loading' | 'ready' | 'running'

export interface MergeDialogState {
    isOpen: boolean
    status: MergeDialogStatus
    sessionName: string | null
    preview: MergePreviewResponse | null
    error?: string | null
}

type ShortcutMergeResultBase = {
    autoMarkedReady?: boolean
}

export type ShortcutMergeResult =
    | (ShortcutMergeResultBase & { status: 'started' })
    | (ShortcutMergeResultBase & { status: 'needs-modal'; reason: 'conflict' | 'missing-commit' | 'confirm' })
    | (ShortcutMergeResultBase & { status: 'blocked'; reason: 'no-session' | 'not-ready' | 'in-flight' | 'already-merged' })
    | (ShortcutMergeResultBase & { status: 'error'; message: string })

export type SessionMutationKind = 'merge' | 'remove'

const PENDING_STARTUP_TTL_MS = 10_000

interface PendingStartup {
    agentType?: AgentType
    expiresAt: number
    enqueuedAt: number
}

function applySessionMutationState(
    previous: Map<string, Set<SessionMutationKind>>,
    sessionId: string,
    kind: SessionMutationKind,
    active: boolean
): Map<string, Set<SessionMutationKind>> {
    const next = new Map(previous)
    const existing = new Set(next.get(sessionId) ?? [])

    if (active) {
        existing.add(kind)
        next.set(sessionId, existing)
        return next
    }

    existing.delete(kind)
    if (existing.size > 0) {
        next.set(sessionId, existing)
    } else {
        next.delete(sessionId)
    }
    return next
}

function sortSessionsByCreationDate(sessions: EnrichedSession[]): EnrichedSession[] {
    if (sessions.length === 0) return sessions

    const sessionMap = new Map(sessions.map(session => [session.info.session_id, session]))

    const reviewed = sessions.filter(session => session.info.ready_to_merge)
    const unreviewed = sessions.filter(session => !session.info.ready_to_merge)

    const compareByCreated = (a: EnrichedSession, b: EnrichedSession) => {
        const aTime = new Date(a.info.created_at || 0).getTime()
        const bTime = new Date(b.info.created_at || 0).getTime()
        const diff = bTime - aTime
        if (diff !== 0) {
            return diff
        }
        return a.info.session_id.localeCompare(b.info.session_id)
    }

    const sortedUnreviewed = [...unreviewed].sort(compareByCreated)

    const sortedReviewed = [...reviewed].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))

    const sorted = [...sortedUnreviewed, ...sortedReviewed]
    return sorted.map(session => sessionMap.get(session.info.session_id) ?? session)
}

function filterSessions(sessions: EnrichedSession[], filterMode: FilterMode): EnrichedSession[] {
    switch (filterMode) {
        case FilterMode.Spec:
            return sessions.filter(session => mapSessionUiState(session.info) === SessionState.Spec)
        case FilterMode.Running:
            return sessions.filter(session => mapSessionUiState(session.info) === SessionState.Running)
        case FilterMode.Reviewed:
            return sessions.filter(session => mapSessionUiState(session.info) === SessionState.Reviewed)
        case FilterMode.All:
        default:
            return sessions
    }
}

function defaultMergeDialogState(): MergeDialogState {
    return {
        isOpen: false,
        status: 'idle',
        sessionName: null,
        preview: null,
        error: null,
    }
}

function createPendingStartup(_sessionId: string, agentType?: AgentType, ttlMs: number = PENDING_STARTUP_TTL_MS): PendingStartup {
    const enqueuedAt = Date.now()
    return {
        agentType,
        enqueuedAt,
        expiresAt: enqueuedAt + ttlMs,
    }
}

function enrichDraftSessions(drafts: RawSession[]): EnrichedSession[] {
    return drafts.map(spec => ({
        id: spec.id,
        info: {
            session_id: spec.name,
            display_name: spec.display_name || spec.name,
            branch: spec.branch,
            worktree_path: spec.worktree_path || '',
            base_branch: spec.parent_branch,
            parent_branch: spec.parent_branch,
            status: 'spec',
            session_state: SessionState.Spec,
            created_at: spec.created_at ? new Date(spec.created_at).toISOString() : undefined,
            last_modified: spec.updated_at ? new Date(spec.updated_at).toISOString() : undefined,
            has_uncommitted_changes: false,
            ready_to_merge: false,
            diff_stats: undefined,
            is_current: false,
            session_type: 'worktree',
        },
        terminals: [],
    }))
}

function buildStateMap(sessions: EnrichedSession[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const session of sessions) {
        map.set(session.info.session_id, mapSessionUiState(session.info))
    }
    return map
}

function dedupeSessions(sessions: EnrichedSession[]): EnrichedSession[] {
    const byId = new Map<string, EnrichedSession>()
    for (const session of sessions) {
        const sessionId = session.info.session_id
        const existing = byId.get(sessionId)
        if (!existing) {
            byId.set(sessionId, session)
            continue
        }

        const existingState = mapSessionUiState(existing.info)
        if (existingState === SessionState.Spec) {
            continue
        }
        const nextState = mapSessionUiState(session.info)
        if (nextState === SessionState.Spec) {
            byId.set(sessionId, session)
            continue
        }
        byId.set(sessionId, session)
    }
    return Array.from(byId.values())
}

function mergeSessionsPreferDraft(base: EnrichedSession[], specs: EnrichedSession[]): EnrichedSession[] {
    const byId = new Map<string, EnrichedSession>()
    for (const session of base) {
        byId.set(session.info.session_id, session)
    }
    for (const draft of specs) {
        const existing = byId.get(draft.info.session_id)
        if (!existing || mapSessionUiState(existing.info) !== 'spec') {
            byId.set(draft.info.session_id, draft)
        }
    }
    return Array.from(byId.values())
}

function releaseRemovedSessions(get: Getter, set: Setter, previous: EnrichedSession[], next: EnrichedSession[]) {
    if (!previous.length) {
        return
    }

    const nextIds = new Set(next.map(session => session.info.session_id))
    const removed: string[] = []
    for (const session of previous) {
        const sessionId = session.info.session_id
        if (!nextIds.has(sessionId)) {
            removed.push(sessionId)
        }
    }

    if (removed.length === 0) {
        return
    }

    const pending = new Map(get(pendingStartupsAtom))
    let pendingChanged = false
    for (const sessionId of removed) {
        if (pending.delete(sessionId)) {
            pendingChanged = true
        }
        suppressedAutoStart.delete(sessionId)
        releaseSessionTerminals(sessionId)
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, pending)
    }

    logger.debug(
        `[SessionsAtoms] releaseRemovedSessions removed ${removed.length} session terminals (previous=${previous.length}, next=${next.length}): ${removed.join(', ')}`,
    )
}

function syncMergeStatuses(set: Setter, sessions: EnrichedSession[]) {
    set(mergeStatusesStateAtom, (prev) => {
        const next = new Map(prev)
        const seen = new Set<string>()
        for (const session of sessions) {
            const sessionId = session.info.session_id
            const status = deriveMergeStatusFromSession(session)
            if (status) {
                next.set(sessionId, status)
            } else {
                next.delete(sessionId)
            }
            seen.add(sessionId)
        }

        for (const key of Array.from(next.keys())) {
            if (!seen.has(key)) {
                next.delete(key)
            }
        }

        return next
    })
}

function autoStartRunningSessions(
    get: Getter,
    set: Setter,
    sessions: EnrichedSession[],
    options: { reason?: string; previousStates?: Map<string, string> },
) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return
    }

    const pending = new Map(get(pendingStartupsAtom))
    const previousStates = options.previousStates ?? previousSessionStates
    const reason = options.reason ?? 'sessions-refresh'
    const projectPath = get(projectPathAtom)

    let pendingChanged = false
    const now = Date.now()
    for (const [sessionId, entry] of pending) {
        if (entry.expiresAt <= now) {
            pending.delete(sessionId)
            pendingChanged = true
            logger.warn(`[AGENT_LAUNCH_TRACE] pending startup expired for ${sessionId} (ttl=${PENDING_STARTUP_TTL_MS}ms)`)
        }
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, new Map(pending))
    }

    for (const session of sessions) {
        const sessionId = session?.info?.session_id
        if (!sessionId) {
            continue
        }

        const nextState = mapSessionUiState(session.info)
        const topId = stableSessionTerminalId(sessionId, 'top')
        const pendingEntry = pending.get(sessionId)

        if (pendingEntry && nextState !== SessionState.Running) {
            if (nextState === SessionState.Spec) {
                pending.delete(sessionId)
                suppressedAutoStart.add(sessionId)
            }
            continue
        }

        if (pendingEntry && nextState === SessionState.Running) {
            if (hasBackgroundStart(topId) || hasInflight(topId)) {
                logger.info(`[AGENT_LAUNCH_TRACE] pending startup skipping ${sessionId}; background mark or inflight present`)
                pending.delete(sessionId)
                suppressedAutoStart.add(sessionId)
                pendingChanged = true
                continue
            }

            pending.delete(sessionId)
            suppressedAutoStart.delete(sessionId)
            pendingChanged = true

            const pendingElapsed = Date.now() - pendingEntry.enqueuedAt
            logger.info(`[AGENT_LAUNCH_TRACE] pending startup starting ${sessionId} (queued=${pendingElapsed}ms, reason=${reason})`)
            void (async () => {
                try {
                    const projectOrchestratorId = computeProjectOrchestratorId(projectPath ?? null)
                    const fallbackAgent = session.info.original_agent_type ?? undefined
                    await startSessionTop({
                        sessionName: sessionId,
                        topId,
                        projectOrchestratorId,
                        agentType: pendingEntry.agentType ?? fallbackAgent,
                    })
                    const totalElapsed = Date.now() - pendingEntry.enqueuedAt
                    logger.info(`[SpecStart] Agent ready after pending start`, {
                        sessionId,
                        queuedDurationMs: pendingElapsed,
                        totalDurationMs: totalElapsed,
                        agentType: pendingEntry.agentType ?? fallbackAgent ?? 'default',
                    })
                } catch (error) {
                    const message = getErrorMessage(error)
                    if (message.includes('Permission required for folder:')) {
                        emitUiEvent(UiEvent.PermissionError, { error: message })
                    } else {
                        logger.warn(`[SessionsAtoms] Pending start failed for ${sessionId}:`, error)
                    }
                }
            })()
            continue
        }

        if (nextState !== SessionState.Running) {
            suppressedAutoStart.delete(sessionId)
            continue
        }

        if (suppressedAutoStart.has(sessionId)) {
            logger.debug(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}: suppressed`)
            continue
        }

        const wasRunning = previousStates.get(sessionId) === SessionState.Running
        if (wasRunning) {
            logger.debug(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}: was already running`)
            continue
        }

        if (hasBackgroundStart(topId) || hasInflight(topId)) {
            logger.info(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - skipping ${sessionId}; background mark or inflight present (${reason})`)
            continue
        }

        logger.info(`[AGENT_LAUNCH_TRACE] autoStartRunningSessions - will auto-start ${sessionId} (reason: ${reason})`)

        void (async () => {
            try {
                const projectOrchestratorId = computeProjectOrchestratorId(projectPath ?? null)
                const agentType = session.info.original_agent_type ?? undefined
                await startSessionTop({ sessionName: sessionId, topId, projectOrchestratorId, agentType })
                logger.info(`[SessionsAtoms] Started agent for ${sessionId} (${reason}).`)
            } catch (error) {
                const message = getErrorMessage(error)
                if (message.includes('Permission required for folder:')) {
                    emitUiEvent(UiEvent.PermissionError, { error: message })
                } else {
                    logger.warn(`[SessionsAtoms] Auto-start failed for ${sessionId} (${reason}):`, error)
                }
            }
        })()
    }

    if (pendingChanged) {
        set(pendingStartupsAtom, new Map(pending))
    }
}

function attachMergeSnapshot(
    session: EnrichedSession,
    previousSessions: Map<string, EnrichedSession>,
): EnrichedSession {
    const previous = previousSessions.get(session.info.session_id)
    const cached = mergePreviewCache.get(session.info.session_id) ?? null

    const mergeHasConflicts = session.info.merge_has_conflicts
        ?? previous?.info.merge_has_conflicts
        ?? (cached ? cached.hasConflicts : undefined)
    const mergeIsUpToDate = session.info.merge_is_up_to_date
        ?? previous?.info.merge_is_up_to_date
        ?? (cached ? cached.isUpToDate : undefined)
    const mergeConflictingPaths = session.info.merge_conflicting_paths
        ?? previous?.info.merge_conflicting_paths
        ?? (cached && cached.conflictingPaths.length ? cached.conflictingPaths : undefined)

    if (
        mergeHasConflicts === session.info.merge_has_conflicts &&
        mergeIsUpToDate === session.info.merge_is_up_to_date &&
        mergeConflictingPaths === session.info.merge_conflicting_paths
    ) {
        return session
    }

    return {
        ...session,
        info: {
            ...session.info,
            merge_has_conflicts: mergeHasConflicts,
            merge_is_up_to_date: mergeIsUpToDate,
            merge_conflicting_paths: mergeConflictingPaths,
        },
    }
}

function applySessionsSnapshot(
    get: Getter,
    set: Setter,
    sessions: EnrichedSession[],
    options: { reason?: string; previousStates?: Map<string, string> } = {},
) {
    const projectPath = get(projectPathAtom)
    const previousMap = new Map(previousSessionsSnapshot.map(session => [session.info.session_id, session]))
    const withSnapshots = sessions.map(session => attachMergeSnapshot(session, previousMap))
    const deduped = dedupeSessions(withSnapshots)

    if (projectPath) {
        releaseRemovedSessions(get, set, previousSessionsSnapshot, deduped)
    }
    set(allSessionsAtom, deduped)
    previousSessionsSnapshot = deduped

    syncMergeStatuses(set, deduped)
    autoStartRunningSessions(get, set, deduped, {
        reason: options.reason,
        previousStates: options.previousStates ?? previousSessionStates,
    })

    const stateMap = buildStateMap(deduped)
    previousSessionStates = stateMap

    if (projectPath) {
        projectSessionsSnapshotCache.set(projectPath, deduped)
        projectSessionStatesCache.set(projectPath, new Map(stateMap))
    }
}

function cacheProjectSnapshot(projectPath: string, sessions: EnrichedSession[]) {
    const previous = projectSessionsSnapshotCache.get(projectPath) ?? []
    const previousMap = new Map(previous.map(session => [session.info.session_id, session]))
    const withSnapshots = sessions.map(session => attachMergeSnapshot(session, previousMap))
    const deduped = dedupeSessions(withSnapshots)
    projectSessionsSnapshotCache.set(projectPath, deduped)
    projectSessionStatesCache.set(projectPath, buildStateMap(deduped))
}

function parseSessionsRefreshedPayload(payload: unknown): { projectPath: string | null; sessions: EnrichedSession[] } {
    if (payload && typeof payload === 'object' && payload !== null && 'sessions' in payload) {
        const scoped = payload as Partial<SessionsRefreshedEventPayload>
        const projectPath = typeof scoped.projectPath === 'string' ? scoped.projectPath : null
        const sessions = Array.isArray(scoped.sessions) ? scoped.sessions : []
        return { projectPath, sessions }
    }
    if (Array.isArray(payload)) {
        return { projectPath: null, sessions: payload as EnrichedSession[] }
    }
    return { projectPath: null, sessions: [] }
}

function syncSnapshotsFromAtom(get: Getter) {
    const current = get(allSessionsAtom)
    previousSessionsSnapshot = current
    previousSessionStates = buildStateMap(current)
}

async function loadSessionsSnapshot(projectPath: string | null): Promise<EnrichedSession[]> {
    if (!projectPath) {
        return []
    }

    const cacheKey = `list_enriched_sessions:${projectPath}`
    const enrichedSessions = await singleflight(cacheKey, () => invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions))
    const enriched = Array.isArray(enrichedSessions) ? enrichedSessions : []

    const hasSpecSessions = enriched.some(session => mapSessionUiState(session.info) === SessionState.Spec)
    if (hasSpecSessions) {
        return enriched
    }

    try {
        const draftSessions = await invoke<RawSession[]>(TauriCommands.SchaltwerkCoreListSessionsByState, { state: SessionState.Spec })
        if (Array.isArray(draftSessions) && draftSessions.some(draft => draft && (draft.name || draft.id))) {
            const enrichedDrafts = enrichDraftSessions(draftSessions)
            return mergeSessionsPreferDraft(enriched, enrichedDrafts)
        }
    } catch (error) {
        logger.warn('[SessionsAtoms] Failed to fetch draft sessions, continuing with enriched sessions only:', error)
    }

    return enriched
}

function deriveMergeStatusFromSession(session: EnrichedSession): MergeStatus | undefined {
    const { info } = session

    if (!info.ready_to_merge) {
        return undefined
    }

    if (info.merge_has_conflicts === true || info.has_conflicts === true) {
        return 'conflict'
    }

    if (info.merge_is_up_to_date === true) {
        return 'merged'
    }

    if (Array.isArray(info.merge_conflicting_paths) && info.merge_conflicting_paths.length > 0) {
        return 'conflict'
    }

    const diff = info.diff_stats
    if (!diff) {
        return undefined
    }

    const filesChanged = diff.files_changed ?? 0
    const additions = (diff.additions ?? diff.insertions) ?? 0
    const deletions = diff.deletions ?? 0
    const insertions = diff.insertions ?? diff.additions ?? 0

    if (filesChanged === 0 && additions === 0 && deletions === 0 && insertions === 0) {
        return 'merged'
    }

    return undefined
}

function getErrorMessage(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (value && typeof value === 'object' && 'message' in value) {
        const message = (value as { message?: unknown }).message
        if (typeof message === 'string' && message.trim().length > 0) {
            return message
        }
    }
    return 'Unknown error'
}

export const allSessionsAtom = atom<EnrichedSession[]>([])
const filterModeStateAtom = atom<FilterMode>(getDefaultFilterMode())
const searchQueryStateAtom = atom<string>('')
const isSearchVisibleStateAtom = atom<boolean>(false)
const lastRefreshStateAtom = atom<number>(0)
const mergeDialogStateAtom = atom<MergeDialogState>(defaultMergeDialogState())
const mergeStatusesStateAtom = atom<Map<string, MergeStatus>>(new Map())
const mergeInFlightStateAtom = atom<Map<string, boolean>>(new Map())
const sessionMutationsStateAtom = atom<Map<string, Set<SessionMutationKind>>>(new Map())
export const pendingStartupsAtom = atom<Map<string, PendingStartup>>(new Map())
const loadingStateAtom = atom<boolean>(false)
const settingsLoadedAtom = atom<boolean>(false)
const autoCancelAfterMergeStateAtom = atom<boolean>(true)
const currentSelectionStateAtom = atom<string | null>(null)

let lastPersistedFilterMode: FilterMode | null = null

type PushToast = (toast: { tone: 'success' | 'error'; title: string; description?: string }) => void

let pushToastHandler: PushToast | null = null
let previousSessionsSnapshot: EnrichedSession[] = []
let previousSessionStates = new Map<string, string>()
const projectSessionsSnapshotCache = new Map<string, EnrichedSession[]>()
const projectSessionStatesCache = new Map<string, Map<string, string>>()
const suppressedAutoStart = new Set<string>()
const mergeErrorCache = new Map<string, string>()
const mergePreviewCache = new Map<string, MergePreviewResponse>()
let sessionsRefreshedReloadPending = false
const sessionsEventHandlersForTests = new Map<SchaltEvent, (payload: unknown) => void>()

export function __getSessionsEventHandlerForTest(event: SchaltEvent): ((payload: unknown) => void) | undefined {
    return sessionsEventHandlersForTests.get(event)
}

export const autoCancelAfterMergeAtom = atom((get) => get(autoCancelAfterMergeStateAtom))
export const sessionsLoadingAtom = atom((get) => get(loadingStateAtom))

export function setSessionsToastHandlers(handlers: { pushToast?: PushToast | null }) {
    pushToastHandler = handlers.pushToast ?? null
}

export const filterModeAtom = atom(
    (get) => get(filterModeStateAtom),
    (_get, set, mode: FilterMode) => {
        if (!isValidFilterMode(mode)) {
            return
        }
        set(filterModeStateAtom, mode)
        set(setSelectionFilterModeActionAtom, mode)
        void set(persistSessionsSettingsAtom)
    },
)

export const searchQueryAtom = atom(
    (get) => get(searchQueryStateAtom),
    (_get, set, query: string) => {
        set(searchQueryStateAtom, query)
    },
)

export const isSearchVisibleAtom = atom(
    (get) => get(isSearchVisibleStateAtom),
    (_get, set, value: boolean) => {
        set(isSearchVisibleStateAtom, value)
    },
)

const searchedSessionsAtom = atom((get) => {
    const sessions = get(allSessionsAtom)
    const query = get(searchQueryStateAtom)
    return searchSessionsUtil(sessions, query)
})

export const filteredSessionsAtom = atom((get) => {
    const sessions = get(searchedSessionsAtom)
    const filterMode = get(filterModeStateAtom)
    return filterSessions(sessions, filterMode)
})

export const sortedSessionsAtom = atom((get) => {
    const sessions = get(filteredSessionsAtom)
    return sortSessionsByCreationDate(sessions)
})

export const sessionsAtom = atom((get) => get(sortedSessionsAtom))

export const lastRefreshAtom = atom((get) => get(lastRefreshStateAtom))

export const mergeDialogAtom = atom((get) => get(mergeDialogStateAtom))

export const mergeStatusSelectorAtom = atom((get) => {
    const statuses = get(mergeStatusesStateAtom)
    return (sessionId: string): MergeStatus | undefined => statuses.get(sessionId)
})

export const mergeInFlightSelectorAtom = atom((get) => {
    const statuses = get(mergeInFlightStateAtom)
    return (sessionId: string): boolean => statuses.get(sessionId) ?? false
})

export const sessionMutationSelectorAtom = atom((get) => {
    const mutations = get(sessionMutationsStateAtom)
    return (sessionId: string, kind: SessionMutationKind): boolean => {
        const entry = mutations.get(sessionId)
        return entry?.has(kind) ?? false
    }
})

export const beginSessionMutationActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; kind: SessionMutationKind }) => {
        set(sessionMutationsStateAtom, (prev) => applySessionMutationState(prev, input.sessionId, input.kind, true))
    },
)

export const endSessionMutationActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; kind: SessionMutationKind }) => {
        set(sessionMutationsStateAtom, (prev) => applySessionMutationState(prev, input.sessionId, input.kind, false))
    },
)

export const enqueuePendingStartupActionAtom = atom(
    null,
    (get, set, input: { sessionId: string; agentType?: AgentType; ttlMs?: number }) => {
        suppressedAutoStart.delete(input.sessionId)
        set(pendingStartupsAtom, (prev) => {
            const next = new Map(prev)
            next.set(input.sessionId, createPendingStartup(input.sessionId, input.agentType, input.ttlMs))
            return next
        })

        const existingSessions = get(allSessionsAtom)
        const existing = existingSessions.find(session => session.info.session_id === input.sessionId)
        if (!existing) {
            return
        }

        if (mapSessionUiState(existing.info) !== SessionState.Running) {
            return
        }

        const previousStatesOverride = new Map(previousSessionStates)
        previousStatesOverride.delete(input.sessionId)

        autoStartRunningSessions(get, set, [existing], {
            reason: 'pending-startup-enqueue',
            previousStates: previousStatesOverride,
        })
    },
)

export const clearPendingStartupActionAtom = atom(
    null,
    (_get, set, sessionId: string) => {
        set(pendingStartupsAtom, (prev) => {
            if (!prev.has(sessionId)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    },
)

export const cleanupExpiredPendingStartupsActionAtom = atom(
    null,
    (_get, set) => {
        const now = Date.now()
        set(pendingStartupsAtom, (prev) => {
            let changed = false
            const next = new Map(prev)
            for (const [sessionId, pending] of next) {
                if (now >= pending.expiresAt) {
                    next.delete(sessionId)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    },
)

export const refreshSessionsActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)

        if (projectPath) {
            const cachedSnapshot = projectSessionsSnapshotCache.get(projectPath)
            previousSessionsSnapshot = cachedSnapshot ? [...cachedSnapshot] : []
            const cachedStates = projectSessionStatesCache.get(projectPath)
            previousSessionStates = cachedStates ? new Map(cachedStates) : new Map()
        }

        if (!projectPath) {
            releaseRemovedSessions(get, set, previousSessionsSnapshot, [])
            set(allSessionsAtom, [])
            set(mergeStatusesStateAtom, new Map())
            set(mergeInFlightStateAtom, new Map())
            set(pendingStartupsAtom, new Map())
            suppressedAutoStart.clear()
            previousSessionsSnapshot = []
            previousSessionStates = new Map()
            set(lastRefreshStateAtom, Date.now())
            return
        }

        try {
            const sessions = await loadSessionsSnapshot(projectPath)
            applySessionsSnapshot(get, set, sessions, { reason: 'refresh' })
        } catch (error) {
            logger.error('[SessionsAtoms] Failed to load sessions:', error)
            releaseRemovedSessions(get, set, previousSessionsSnapshot, [])
            previousSessionsSnapshot = []
            previousSessionStates = new Map()
            set(allSessionsAtom, [])
        } finally {
            set(lastRefreshStateAtom, Date.now())
        }
    },
)

export const cleanupProjectSessionsCacheActionAtom = atom(
    null,
    (get, set, projectPath: string | null) => {
        if (!projectPath) {
            return
        }
        const snapshot = projectSessionsSnapshotCache.get(projectPath)
        projectSessionsSnapshotCache.delete(projectPath)
        projectSessionStatesCache.delete(projectPath)
        if (!snapshot || snapshot.length === 0) {
            return
        }
        if (get(projectPathAtom) === projectPath) {
            return
        }
        releaseRemovedSessions(get, set, snapshot, [])
    },
)

const persistSessionsSettingsAtom = atom(
    null,
    async (get) => {
        const loaded = get(settingsLoadedAtom)
        const projectPath = get(projectPathAtom)
        if (!loaded || !projectPath) {
            return
        }

        const filterMode = get(filterModeStateAtom)

        if (lastPersistedFilterMode === filterMode) {
            return
        }

        try {
            await invoke(TauriCommands.SetProjectSessionsSettings, {
                settings: {
                    filter_mode: filterMode,
                },
            })
            lastPersistedFilterMode = filterMode
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to save sessions settings:', error)
            lastPersistedFilterMode = null
        }
    },
)

let sessionsEventsCleanup: (() => void) | null = null
let reloadSessionsPromise: Promise<void> | null = null
let reloadSessionsReplay = false

export const reloadSessionsActionAtom = atom(
    null,
    async (_get, set) => {
        if (reloadSessionsPromise) {
            reloadSessionsReplay = true
            return reloadSessionsPromise
        }

        reloadSessionsPromise = (async () => {
            set(loadingStateAtom, true)
            try {
                let shouldRepeat = false
                do {
                    await set(refreshSessionsActionAtom)
                    shouldRepeat = reloadSessionsReplay
                    reloadSessionsReplay = false
                } while (shouldRepeat)
            } finally {
                set(loadingStateAtom, false)
                reloadSessionsPromise = null
            }
        })()

        return reloadSessionsPromise
    },
)

export const initializeSessionsSettingsActionAtom = atom(
    null,
    async (get, set) => {
        const projectPath = get(projectPathAtom)
        if (!projectPath) {
            set(settingsLoadedAtom, false)
            return
        }

        try {
            const settings = await invoke<{ filter_mode?: string } | null>(TauriCommands.GetProjectSessionsSettings)
            const filter = settings && isValidFilterMode(settings.filter_mode) ? (settings.filter_mode as FilterMode) : getDefaultFilterMode()
            set(filterModeStateAtom, filter)
            set(setSelectionFilterModeActionAtom, filter)
            lastPersistedFilterMode = filter
        } catch {
            lastPersistedFilterMode = null
        } finally {
            set(settingsLoadedAtom, true)
        }

        try {
            const prefs = await invoke<{ auto_cancel_after_merge?: boolean } | null>(TauriCommands.GetProjectMergePreferences)
            if (prefs && typeof prefs.auto_cancel_after_merge === 'boolean') {
                set(autoCancelAfterMergeStateAtom, prefs.auto_cancel_after_merge)
            } else {
                set(autoCancelAfterMergeStateAtom, true)
            }
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to load project merge preferences', error)
            set(autoCancelAfterMergeStateAtom, true)
        }
    },
)

export const updateAutoCancelAfterMergeActionAtom = atom(
    null,
    async (get, set, input: { value: boolean; persist?: boolean }) => {
        const previous = get(autoCancelAfterMergeStateAtom)
        set(autoCancelAfterMergeStateAtom, input.value)

        if (input.persist === false) {
            return
        }

        try {
            await invoke(TauriCommands.SetProjectMergePreferences, {
                preferences: {
                    auto_cancel_after_merge: input.value,
                },
            })
        } catch (error) {
            logger.warn('[SessionsAtoms] Failed to persist project merge preferences', error)
            set(autoCancelAfterMergeStateAtom, previous)
        }
    },
)

export const initializeSessionsEventsActionAtom = atom(
    null,
    async (get, set) => {
        if (sessionsEventsCleanup) {
            return
        }

        const unlisteners: Array<() => void> = []

        const register = async <E extends SchaltEvent>(event: E, handler: (payload: unknown) => void) => {
            const unlisten = await listenEvent(event, (payload) => {
                try {
                    handler(payload)
                } catch (error) {
                    logger.error(`[SessionsAtoms] Failed to handle ${event}:`, error)
                }
            })
            unlisteners.push(unlisten)
            sessionsEventHandlersForTests.set(event, handler)
        }

        await register(SchaltEvent.SessionsRefreshed, (payload) => {
            const normalized = parseSessionsRefreshedPayload(payload)
            const activeProject = get(projectPathAtom)

            if (normalized.projectPath && normalized.projectPath !== activeProject) {
                cacheProjectSnapshot(normalized.projectPath, normalized.sessions)
                return
            }

            if (normalized.sessions.length === 0) {
                if (sessionsRefreshedReloadPending) {
                    logger.debug('[SessionsAtoms] Skipping duplicate reload for empty SessionsRefreshed payload')
                    return
                }
                sessionsRefreshedReloadPending = true
                void (async () => {
                    try {
                        await set(reloadSessionsActionAtom)
                    } catch (error) {
                        logger.warn('[SessionsAtoms] Failed to reload after empty SessionsRefreshed payload:', error)
                    } finally {
                        sessionsRefreshedReloadPending = false
                    }
                })()
                return
            }

            const previousStatesSnapshot = new Map(previousSessionStates)
            applySessionsSnapshot(get, set, normalized.sessions, {
                reason: 'sessions-refreshed',
                previousStates: previousStatesSnapshot,
            })
        })

        await register(SchaltEvent.GitOperationStarted, (payload) => {
            const event = payload as GitOperationPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            mergeErrorCache.delete(sessionName)
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, true)
                return next
            })

            set(mergeStatusesStateAtom, (prev) => {
                if (!prev.has(sessionName)) {
                    return prev
                }
                const next = new Map(prev)
                next.delete(sessionName)
                return next
            })

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'running',
                    error: null,
                }
            })
        })

        await register(SchaltEvent.GitOperationCompleted, (payload) => {
            const event = payload as GitOperationPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            mergeErrorCache.delete(sessionName)
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, false)
                return next
            })

            const status = event.status ?? 'success'

            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                if (status === 'success') {
                    next.set(sessionName, 'merged')
                } else if (status === 'conflict') {
                    next.set(sessionName, 'conflict')
                }
                return next
            })

            if (status === 'success' && pushToastHandler) {
                const shortCommit = event.commit ? event.commit.slice(0, 7) : undefined
                const description = shortCommit
                    ? `Fast-forwarded ${event.parent_branch} to ${shortCommit}`
                    : `Fast-forwarded ${event.parent_branch}`
                pushToastHandler({
                    tone: 'success',
                    title: `Merged ${sessionName}`,
                    description,
                })
            }

            const autoCancel = get(autoCancelAfterMergeStateAtom)
            if (autoCancel && event.operation === 'merge' && (event.status === 'success' || event.status === undefined)) {
                void (async () => {
                    try {
                        await invoke(TauriCommands.SchaltwerkCoreCancelSession, { name: sessionName })
                        await set(reloadSessionsActionAtom)
                    } catch (error) {
                        logger.error(`Failed to auto-cancel session after merge: ${sessionName}`, error)
                        if (pushToastHandler) {
                            pushToastHandler({
                                tone: 'error',
                                title: `Failed to cancel ${sessionName}`,
                                description: getErrorMessage(error),
                            })
                        }
                    }
                })()
            }

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return defaultMergeDialogState()
            })
        })

        await register(SchaltEvent.GitOperationFailed, (payload) => {
            const event = payload as GitOperationFailedPayload
            const sessionName = event?.session_name
            if (!sessionName) {
                return
            }

            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionName, false)
                return next
            })

            if (event.status === 'conflict') {
                set(mergeStatusesStateAtom, (prev) => {
                    const next = new Map(prev)
                    next.set(sessionName, 'conflict')
                    return next
                })
            }

            const message = event.error ?? 'Merge failed'
            const previousError = mergeErrorCache.get(sessionName)
            if (pushToastHandler && previousError !== message) {
                pushToastHandler({
                    tone: 'error',
                    title: `Merge failed for ${sessionName}`,
                    description: message,
                })
            }
            mergeErrorCache.set(sessionName, message)

            set(mergeDialogStateAtom, (prev) => {
                if (!prev.isOpen || prev.sessionName !== sessionName) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'ready',
                    error: message,
                }
            })
        })

        await register(SchaltEvent.SessionActivity, (payload) => {
            const event = payload as { session_name: string; last_activity_ts: number; current_task?: string | null; todo_percentage?: number | null; is_blocked?: boolean | null }
            set(allSessionsAtom, (prev) => prev.map(session => {
                if (session.info.session_id !== event.session_name) {
                    return session
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        last_modified: new Date((event.last_activity_ts ?? 0) * 1000).toISOString(),
                        last_modified_ts: (event.last_activity_ts ?? 0) * 1000,
                        current_task: event.current_task ?? session.info.current_task,
                        todo_percentage: event.todo_percentage ?? session.info.todo_percentage,
                        is_blocked: event.is_blocked ?? session.info.is_blocked,
                    },
                }
            }))
            syncSnapshotsFromAtom(get)
        })

        await register(SchaltEvent.TerminalAttention, (payload) => {
            const event = payload as { session_id: string; terminal_id: string; needs_attention?: boolean }
            if (!isTopTerminalId(event.terminal_id)) {
                logger.debug('[SessionsAtoms] Ignoring attention event from non-top terminal', event)
                return
            }
            set(allSessionsAtom, (prev) => {
                const targetIndex = prev.findIndex(session => session.info.session_id === event.session_id)
                if (targetIndex === -1) {
                    return prev
                }
                const target = prev[targetIndex]
                const nextAttention = event.needs_attention ? true : undefined
                if (target.info.attention_required === nextAttention) {
                    return prev
                }
                const updated = [...prev]
                updated[targetIndex] = {
                    ...target,
                    info: {
                        ...target.info,
                        attention_required: nextAttention,
                    },
                }
                return updated
            })
            syncSnapshotsFromAtom(get)
        })

        await register(SchaltEvent.SessionGitStats, (payload) => {
            const event = payload as {
                session_name: string
                files_changed?: number
                lines_added?: number
                lines_removed?: number
                has_uncommitted?: boolean
                has_conflicts?: boolean
                top_uncommitted_paths?: string[] | null
                merge_has_conflicts?: boolean
                merge_is_up_to_date?: boolean
                merge_conflicting_paths?: string[] | null
            }

            set(allSessionsAtom, (prev) => prev.map(session => {
                if (session.info.session_id !== event.session_name) {
                    return session
                }
                const diffStats = {
                    files_changed: event.files_changed ?? 0,
                    additions: event.lines_added ?? 0,
                    deletions: event.lines_removed ?? 0,
                    insertions: event.lines_added ?? 0,
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        diff_stats: diffStats,
                        has_uncommitted_changes: event.has_uncommitted ?? session.info.has_uncommitted_changes,
                        has_conflicts: event.has_conflicts ?? session.info.has_conflicts,
                        top_uncommitted_paths: event.top_uncommitted_paths && event.top_uncommitted_paths.length > 0
                            ? event.top_uncommitted_paths
                            : session.info.top_uncommitted_paths,
                        merge_has_conflicts: event.merge_has_conflicts ?? session.info.merge_has_conflicts,
                        merge_is_up_to_date: typeof event.merge_is_up_to_date === 'boolean'
                            ? event.merge_is_up_to_date
                            : session.info.merge_is_up_to_date,
                        merge_conflicting_paths: event.merge_conflicting_paths && event.merge_conflicting_paths.length > 0
                            ? event.merge_conflicting_paths
                            : session.info.merge_conflicting_paths,
                    },
                }
            }))
            syncSnapshotsFromAtom(get)

            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                const conflictFlag = event.merge_has_conflicts
                if (conflictFlag === true || (conflictFlag === undefined && event.has_conflicts)) {
                    next.set(event.session_name, 'conflict')
                } else if (conflictFlag === false || (!event.has_conflicts && conflictFlag === undefined)) {
                    if (next.get(event.session_name) === 'conflict') {
                        next.delete(event.session_name)
                    }
                }

                const upToDateFlag = event.merge_is_up_to_date
                if (upToDateFlag === true) {
                    next.set(event.session_name, 'merged')
                } else if (upToDateFlag === false) {
                    if (next.get(event.session_name) === 'merged') {
                        next.delete(event.session_name)
                    }
                } else if (conflictFlag === undefined) {
                    const noDiff = (event.files_changed ?? 0) === 0
                        && (event.has_uncommitted ?? false) === false
                        && (event.has_conflicts ?? false) === false
                    if (noDiff) {
                        next.set(event.session_name, 'merged')
                    } else if (next.get(event.session_name) === 'merged') {
                        next.delete(event.session_name)
                    }
                }

                return next
            })
        })

        await register(SchaltEvent.SessionAdded, (payload) => {
            const event = payload as {
                session_name: string
                branch?: string
                worktree_path?: string
                parent_branch?: string
                created_at?: string
                last_modified?: string
            }

            const previousStatesSnapshot = new Map(previousSessionStates)
            const pendingStartup = get(pendingStartupsAtom).get(event.session_name) ?? null

            set(allSessionsAtom, (prev) => {
                if (prev.some(session => session.info.session_id === event.session_name)) {
                    return prev
                }
                const nowIso = new Date().toISOString()
                const createdAtIso = event.created_at ?? nowIso
                const lastModifiedIso = event.last_modified ?? createdAtIso
                const info: SessionInfo = {
                    session_id: event.session_name,
                    branch: event.branch ?? '',
                    worktree_path: event.worktree_path ?? '',
                    base_branch: event.parent_branch ?? '',
                    parent_branch: event.parent_branch ?? null,
                    status: 'active' as const,
                    created_at: createdAtIso,
                    last_modified: lastModifiedIso,
                    has_uncommitted_changes: false,
                    has_conflicts: false,
                    is_current: false,
                    session_type: 'worktree',
                    container_status: undefined,
                    session_state: SessionState.Running,
                    current_task: undefined,
                    todo_percentage: undefined,
                    is_blocked: undefined,
                    original_agent_type: pendingStartup?.agentType,
                    diff_stats: undefined,
                    ready_to_merge: false,
                }
                const terminals = [
                    stableSessionTerminalId(event.session_name, 'top'),
                    stableSessionTerminalId(event.session_name, 'bottom'),
                ]
                const enriched: EnrichedSession = { info, terminals }
                return [enriched, ...prev]
            })

            syncSnapshotsFromAtom(get)

            const addedSession = get(allSessionsAtom).find(session => session.info.session_id === event.session_name)
            if (addedSession) {
                autoStartRunningSessions(get, set, [addedSession], {
                    reason: 'session-added',
                    previousStates: previousStatesSnapshot,
                })
            }
        })

        await register(SchaltEvent.SessionCancelling, (payload) => {
            const event = payload as { session_name: string }
            set(allSessionsAtom, (prev) => prev.map(session => {
                if (session.info.session_id !== event.session_name) {
                    return session
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        status: 'spec' as const,
                    },
                }
            }))
            syncSnapshotsFromAtom(get)
        })

        await register(SchaltEvent.SessionRemoved, (payload) => {
            const event = payload as { session_name: string }
            let removed = false
            set(allSessionsAtom, (prev) => {
                if (!prev.some(session => session.info.session_id === event.session_name)) {
                    removed = false
                    return prev
                }
                removed = true
                return prev.filter(session => session.info.session_id !== event.session_name)
            })

            if (removed) {
                releaseSessionTerminals(event.session_name)
                suppressedAutoStart.delete(event.session_name)
                const pending = new Map(get(pendingStartupsAtom))
                if (pending.delete(event.session_name)) {
                    set(pendingStartupsAtom, pending)
                }
                set(mergeStatusesStateAtom, (prev) => {
                    if (!prev.has(event.session_name)) {
                        return prev
                    }
                    const next = new Map(prev)
                    next.delete(event.session_name)
                    return next
                })
                set(sessionMutationsStateAtom, (prev) => {
                    if (!prev.has(event.session_name)) {
                        return prev
                    }
                    const next = new Map(prev)
                    next.delete(event.session_name)
                    return next
                })
            }

            previousSessionStates.delete(event.session_name)
            syncSnapshotsFromAtom(get)
        })

        sessionsEventsCleanup = () => {
            for (const unlisten of unlisteners.splice(0)) {
                try {
                    unlisten()
                } catch (error) {
                    logger.debug('[SessionsAtoms] Failed to remove session event listener during cleanup', { error })
                }
            }
            sessionsEventsCleanup = null
            sessionsRefreshedReloadPending = false
            sessionsEventHandlersForTests.clear()
        }
    },
)

export function __resetSessionsTestingState() {
    if (sessionsEventsCleanup) {
        try {
            sessionsEventsCleanup()
        } catch (error) {
            logger.debug('[SessionsAtoms] Failed to run sessionsEventsCleanup during reset', { error })
        }
    }
    sessionsEventsCleanup = null
    reloadSessionsPromise = null
    reloadSessionsReplay = false
    pushToastHandler = null
    sessionsRefreshedReloadPending = false
    previousSessionsSnapshot = []
    previousSessionStates = new Map()
    projectSessionsSnapshotCache.clear()
    projectSessionStatesCache.clear()
    suppressedAutoStart.clear()
    mergeErrorCache.clear()
    mergePreviewCache.clear()
    sessionsEventHandlersForTests.clear()
}

export const openMergeDialogActionAtom = atom(
    null,
    async (_get, set, sessionId: string) => {
        set(mergeDialogStateAtom, {
            isOpen: true,
            status: 'loading',
            sessionName: sessionId,
            preview: null,
            error: null,
        })

        try {
            const preview = await invoke<MergePreviewResponse>(TauriCommands.SchaltwerkCoreGetMergePreview, { name: sessionId })
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview,
                error: null,
            })

            mergePreviewCache.set(sessionId, preview)

            if (preview?.hasConflicts) {
                set(mergeStatusesStateAtom, (prev) => {
                    const next = new Map(prev)
                    next.set(sessionId, 'conflict')
                    return next
                })
            }
        } catch (error) {
            logger.error(`Failed to prepare merge for session ${sessionId}`, error)
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'idle',
                sessionName: sessionId,
                preview: null,
                error: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    },
)

export const closeMergeDialogActionAtom = atom(
    null,
    (_get, set) => {
        set(mergeDialogStateAtom, defaultMergeDialogState())
    },
)

export const confirmMergeActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; mode: MergeModeOption; commitMessage?: string }) => {
        const current = get(mergeInFlightStateAtom)
        if (current.get(input.sessionId)) {
            return
        }

        set(mergeInFlightStateAtom, (prev) => {
            const next = new Map(prev)
            next.set(input.sessionId, true)
            return next
        })

        try {
            await invoke(TauriCommands.SchaltwerkCoreMergeSessionToMain, {
                name: input.sessionId,
                mode: input.mode,
                commitMessage: input.commitMessage ?? null,
            })

            set(mergeDialogStateAtom, defaultMergeDialogState())
        } finally {
            set(mergeInFlightStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(input.sessionId, false)
                return next
            })
        }
    },
)

export const shortcutMergeActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; commitMessage?: string | null }): Promise<ShortcutMergeResult> => {
        const sessionId = input.sessionId
        if (!sessionId) {
            return { status: 'blocked', reason: 'no-session' }
        }

        const findSession = () => get(allSessionsAtom).find(candidate => candidate.info.session_id === sessionId) ?? null

        let session = findSession()
        if (!session) {
            return { status: 'blocked', reason: 'no-session' }
        }

        let autoMarkedReady = false

        if (!session.info.ready_to_merge) {
            if (session.info.session_state === 'spec') {
                return { status: 'blocked', reason: 'not-ready' }
            }

            try {
                await invoke<boolean>(TauriCommands.SchaltwerkCoreMarkSessionReady, {
                    name: sessionId,
                    autoCommit: true,
                    commitMessage: null,
                })
            } catch (error) {
                return { status: 'error', message: getErrorMessage(error) }
            }

            autoMarkedReady = true
            await set(reloadSessionsActionAtom)
            session = findSession()
            if (!session || !session.info.ready_to_merge) {
                return { status: 'blocked', reason: 'not-ready', autoMarkedReady }
            }
        }

        if (session.info.merge_is_up_to_date) {
            return { status: 'blocked', reason: 'already-merged' }
        }

        if (get(mergeInFlightStateAtom).get(sessionId)) {
            return { status: 'blocked', reason: 'in-flight' }
        }

        let preview: MergePreviewResponse
        try {
            preview = await invoke<MergePreviewResponse>(TauriCommands.SchaltwerkCoreGetMergePreview, { name: sessionId })
            mergePreviewCache.set(sessionId, preview)
        } catch (error) {
            return { status: 'error', message: getErrorMessage(error), autoMarkedReady }
        }

        const hasKnownConflicts =
            session.info.merge_has_conflicts === true ||
            session.info.has_conflicts === true ||
            (Array.isArray(session.info.merge_conflicting_paths) && session.info.merge_conflicting_paths.length > 0)

        const previewHasConflicts = preview.hasConflicts || hasKnownConflicts

        const openMergeDialogWithPreview = () => {
            set(mergeDialogStateAtom, {
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview,
                error: null,
            })
        }

        if (previewHasConflicts) {
            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionId, 'conflict')
                return next
            })

            openMergeDialogWithPreview()

            return { status: 'needs-modal', reason: 'conflict', autoMarkedReady }
        }

        if (preview.isUpToDate) {
            set(mergeStatusesStateAtom, (prev) => {
                const next = new Map(prev)
                next.set(sessionId, 'merged')
                return next
            })
            return { status: 'blocked', reason: 'already-merged', autoMarkedReady }
        }

        const commitFromInput = typeof input.commitMessage === 'string' ? input.commitMessage.trim() : ''
        const commitMessage = (commitFromInput || preview.defaultCommitMessage || '').trim()

        if (!commitMessage) {
            openMergeDialogWithPreview()
            return { status: 'needs-modal', reason: 'missing-commit', autoMarkedReady }
        }

        openMergeDialogWithPreview()
        return { status: 'needs-modal', reason: 'confirm', autoMarkedReady }
    },
)

export const setCurrentSelectionActionAtom = atom(
    null,
    (_get, set, sessionId: string | null) => {
        set(currentSelectionStateAtom, sessionId)
    },
)

export const updateSessionStatusActionAtom = atom(
    null,
    async (get, set, input: { sessionId: string; status: 'spec' | 'active' | 'dirty' }) => {
        const projectPath = get(projectPathAtom)
        if (!projectPath) {
            return
        }

        const sessions = get(allSessionsAtom)
        const session = sessions.find(s => s.info.session_id === input.sessionId)
        if (!session) {
            return
        }

        try {
            if (input.status === 'spec') {
                await invoke(TauriCommands.SchaltwerkCoreConvertSessionToDraft, { name: input.sessionId })
            } else if (input.status === 'active') {
                if (session.info.status === 'spec') {
                    await invoke(TauriCommands.SchaltwerkCoreStartSpecSession, { name: input.sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke(TauriCommands.SchaltwerkCoreUnmarkReady, { name: input.sessionId })
                }
            } else if (input.status === 'dirty') {
                await invoke(TauriCommands.SchaltwerkCoreMarkReady, { name: input.sessionId })
            }
        } finally {
            await set(refreshSessionsActionAtom)
        }
    },
)

export const createDraftActionAtom = atom(
    null,
    async (_get, set, input: { name: string; content: string }) => {
        await invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, {
            name: input.name,
            specContent: input.content,
        })
        await set(refreshSessionsActionAtom)
    },
)

export const updateSessionSpecContentActionAtom = atom(
    null,
    (_get, set, input: { sessionId: string; content: string }) => {
        set(allSessionsAtom, (prev) => {
            let changed = false
            const next = prev.map(session => {
                const matches =
                    session.info.session_id === input.sessionId ||
                    session.info.branch === input.sessionId ||
                    session.info.display_name === input.sessionId

                if (!matches) {
                    return session
                }

                const existing = session.info.spec_content ?? session.info.current_task ?? ''
                if (existing === input.content) {
                    return session
                }

                changed = true
                return {
                    ...session,
                    info: {
                        ...session.info,
                        spec_content: input.content,
                    },
                }
            })

            return changed ? next : prev
        })
    },
)

export const optimisticallyConvertSessionToSpecActionAtom = atom(
    null,
    (_get, set, sessionId: string) => {
        set(allSessionsAtom, (prev) => {
            let mutated = false
            const next = prev.map(session => {
                if (session.info.session_id !== sessionId) {
                    return session
                }
                mutated = true
                return {
                    ...session,
                    info: {
                        ...session.info,
                        session_state: SessionState.Spec,
                        status: 'spec' as const,
                        ready_to_merge: false,
                        has_uncommitted_changes: false,
                        has_conflicts: false,
                        diff_stats: undefined,
                        merge_has_conflicts: undefined,
                        merge_conflicting_paths: undefined,
                        merge_is_up_to_date: undefined,
                    },
                }
            })
            return mutated ? next : prev
        })

        set(mergeStatusesStateAtom, (prev) => {
            if (!prev.has(sessionId)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    },
)
