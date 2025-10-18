import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { useProject } from './ProjectContext'
import { SortMode, FilterMode, getDefaultSortMode, getDefaultFilterMode, isValidSortMode, isValidFilterMode } from '../types/sessionFilters'
import { mapSessionUiState, searchSessions as searchSessionsUtil } from '../utils/sessionFilters'
import { EnrichedSession, SessionInfo, SessionState, RawSession } from '../types/session'
import { logger } from '../utils/logger'
import { useOptionalToast } from '../common/toast/ToastProvider'
import { hasBackgroundStart, emitUiEvent, UiEvent } from '../common/uiEvents'
import { hasInflight, singleflight } from '../utils/singleflight'
import { startSessionTop, computeProjectOrchestratorId } from '../common/agentSpawn'
import { EventPayloadMap, GitOperationFailedPayload, GitOperationPayload } from '../common/events'
import { areSessionInfosEqual } from '../utils/sessionComparison'
import { stableSessionTerminalId, isTopTerminalId } from '../common/terminalIdentity'
import { releaseSessionTerminals } from '../terminal/registry/terminalRegistry'

type MergeModeOption = 'squash' | 'reapply'

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

interface MergeDialogState {
    isOpen: boolean
    status: MergeDialogStatus
    sessionName: string | null
    preview: MergePreviewResponse | null
    error?: string | null
}

type SessionMutationKind = 'merge' | 'remove'

export function applySessionMutationState(
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

function useLatest<T>(value: T) {
    const ref = useRef(value)
    useEffect(() => {
        ref.current = value
    }, [value])
    return ref
}

function isDiffClean(info: SessionInfo): boolean {
    if (info.has_uncommitted_changes === true) {
        return false
    }

    const diff = info.diff_stats
    if (!diff) {
        return false
    }

    const filesChanged = diff.files_changed ?? 0
    const additions = (diff.additions ?? diff.insertions) ?? 0
    const deletions = diff.deletions ?? 0
    const insertions = diff.insertions ?? diff.additions ?? 0

    return filesChanged === 0 && additions === 0 && deletions === 0 && insertions === 0
}

function deriveMergeStatusFromSession(session: EnrichedSession): MergeStatus | undefined {
    const { info } = session

    if (!info.ready_to_merge) {
        return undefined
    }

    if (info.merge_has_conflicts === true) {
        return 'conflict'
    }

    if (info.has_conflicts === true) {
        return 'conflict'
    }

    if (info.merge_is_up_to_date === true) {
        return 'merged'
    }

    if (Array.isArray(info.merge_conflicting_paths) && info.merge_conflicting_paths.length > 0) {
        return 'conflict'
    }

    if (isDiffClean(info)) {
        return 'merged'
    }

    return undefined
}

interface SessionsContextValue {
    sessions: EnrichedSession[]
    allSessions: EnrichedSession[]
    filteredSessions: EnrichedSession[]
    sortedSessions: EnrichedSession[]
    loading: boolean
    sortMode: SortMode
    filterMode: FilterMode
    searchQuery: string
    isSearchVisible: boolean
    setSortMode: (mode: SortMode) => void
    setFilterMode: (mode: FilterMode) => void
    setSearchQuery: (query: string) => void
    setIsSearchVisible: (visible: boolean) => void
    setCurrentSelection: (sessionId: string | null) => void
    reloadSessions: () => Promise<void>
    optimisticallyConvertSessionToSpec: (sessionId: string) => void
    updateSessionStatus: (sessionId: string, newStatus: string) => Promise<void>
    createDraft: (name: string, content: string) => Promise<void>
    mergeDialogState: MergeDialogState
    openMergeDialog: (sessionId: string) => Promise<void>
    closeMergeDialog: () => void
    confirmMerge: (sessionId: string, mode: MergeModeOption, commitMessage?: string) => Promise<void>
    isMergeInFlight: (sessionId: string) => boolean
    getMergeStatus: (sessionId: string) => MergeStatus
    autoCancelAfterMerge: boolean
    updateAutoCancelAfterMerge: (next: boolean, persist?: boolean) => Promise<void>
    beginSessionMutation: (sessionId: string, kind: SessionMutationKind) => void
    endSessionMutation: (sessionId: string, kind: SessionMutationKind) => void
    isSessionMutating: (sessionId: string) => boolean
}

const SessionsContext = createContext<SessionsContextValue | undefined>(undefined)

export type MergeStatus = 'idle' | 'merged' | 'conflict'

const noopToast = () => {}

export function SessionsProvider({ children }: { children: ReactNode }) {
    const { projectPath } = useProject()
    const toast = useOptionalToast()
    const pushToast = toast?.pushToast ?? noopToast
    const [allSessions, setAllSessions] = useState<EnrichedSession[]>([])
    const [loading, setLoading] = useState(true)
    const [sortMode, setSortMode] = useState<SortMode>(getDefaultSortMode())
    const [filterMode, setFilterMode] = useState<FilterMode>(getDefaultFilterMode())
    const [searchQuery, setSearchQuery] = useState<string>('')
    const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false)
    const prevStatesRef = useRef<Map<string, string>>(new Map())
    const [lastProjectPath, setLastProjectPath] = useState<string | null>(null)
    const hasInitialLoadCompleted = useRef(false)
    const currentSelectionRef = useRef<string | null>(null)
    const [settingsLoaded, setSettingsLoaded] = useState(false)
    const [mergeDialogState, setMergeDialogState] = useState<MergeDialogState>({
        isOpen: false,
        status: 'idle',
        sessionName: null,
        preview: null,
        error: null,
    })
    const [mergeInFlight, setMergeInFlight] = useState<Map<string, boolean>>(new Map())
    const [sessionMutations, setSessionMutations] = useState<Map<string, Set<SessionMutationKind>>>(new Map())
    const mergeErrorCacheRef = useRef(new Map<string, string>())
    const [mergeStatuses, setMergeStatuses] = useState<Map<string, MergeStatus>>(new Map())
    const mergePreviewCacheRef = useRef(new Map<string, MergePreviewResponse | null>())
    const pendingMergePreviewRef = useRef(new Set<string>())
    const pendingSessionsReloadRef = useRef(false)
    const [autoCancelAfterMerge, setAutoCancelAfterMerge] = useState(true)
    const autoCancelAfterMergeRef = useLatest(autoCancelAfterMerge)
    const applyAutoCancelPreference = useCallback((next: boolean) => {
        autoCancelAfterMergeRef.current = next
        setAutoCancelAfterMerge(next)
    }, [autoCancelAfterMergeRef])

    const updateSessionMutation = useCallback((sessionId: string, kind: SessionMutationKind, active: boolean) => {
        setSessionMutations(prev => applySessionMutationState(prev, sessionId, kind, active))
    }, [])

    const beginSessionMutation = useCallback((sessionId: string, kind: SessionMutationKind) => {
        updateSessionMutation(sessionId, kind, true)
    }, [updateSessionMutation])

    const endSessionMutation = useCallback((sessionId: string, kind: SessionMutationKind) => {
        updateSessionMutation(sessionId, kind, false)
    }, [updateSessionMutation])

    const isSessionMutating = useCallback((sessionId: string) => {
        const kinds = sessionMutations.get(sessionId)
        return Boolean(kinds && kinds.size > 0)
    }, [sessionMutations])

    const updateMergeInFlight = useCallback((sessionId: string, running: boolean) => {
        updateSessionMutation(sessionId, 'merge', running)
        setMergeInFlight(prev => {
            const next = new Map(prev)
            if (running) {
                next.set(sessionId, true)
            } else {
                next.delete(sessionId)
            }
            return next
        })
    }, [updateSessionMutation])

    const isMergeInFlight = useCallback(
        (sessionId: string) => mergeInFlight.has(sessionId),
        [mergeInFlight]
    )

    const getMergeStatus = useCallback(
        (sessionId: string) => mergeStatuses.get(sessionId) ?? 'idle',
        [mergeStatuses]
    )

    const pushToastRef = useLatest(pushToast)
    const updateMergeInFlightRef = useLatest(updateMergeInFlight)
    const mergeDialogStateRef = useLatest(mergeDialogState)

    const syncMergeStatuses = useCallback((sessions: EnrichedSession[]) => {
        setMergeStatuses(prev => {
            const next = new Map(prev)
            let changed = false
            const seenIds = new Set<string>()

            for (const session of sessions) {
                const sessionId = session.info.session_id
                seenIds.add(sessionId)
                const derived = deriveMergeStatusFromSession(session)
                const previous = next.get(sessionId)

                if (derived) {
                    if (previous !== derived) {
                        next.set(sessionId, derived)
                        changed = true
                    }
                } else if (previous) {
                    next.delete(sessionId)
                    changed = true
                }
            }

            for (const key of Array.from(next.keys())) {
                if (!seenIds.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }

            return changed ? next : prev
        })
    }, [])

    const openMergeDialog = useCallback(async (sessionId: string) => {
        mergeErrorCacheRef.current.delete(sessionId)
        setMergeDialogState(prev => ({
            isOpen: true,
            status: 'loading',
            sessionName: sessionId,
            preview: prev.preview && prev.sessionName === sessionId ? prev.preview : null,
            error: null,
        }))

        try {
            const preview = await invoke<MergePreviewResponse>(
                TauriCommands.SchaltwerkCoreGetMergePreview,
                { name: sessionId }
            )
            mergePreviewCacheRef.current.set(sessionId, preview)
            setAllSessions(prev => prev.map(session => {
                if (session.info.session_id !== sessionId) {
                    return session
                }
                return {
                    ...session,
                    info: {
                        ...session.info,
                        merge_has_conflicts: preview.hasConflicts,
                        merge_conflicting_paths: preview.conflictingPaths.length ? preview.conflictingPaths : undefined,
                        merge_is_up_to_date: preview.isUpToDate,
                    }
                }
            }))
            setMergeStatuses(prev => {
                const next = new Map(prev)
                if (preview.hasConflicts) {
                    next.set(sessionId, 'conflict')
                } else if (preview.isUpToDate) {
                    next.set(sessionId, 'merged')
                } else {
                    next.delete(sessionId)
                }
                return next
            })
            setMergeDialogState({
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview,
                error: null,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            logger.error('[SessionsContext] Failed to load merge preview:', error)
            setMergeDialogState({
                isOpen: true,
                status: 'ready',
                sessionName: sessionId,
                preview: null,
                error: message,
            })
        }
    }, [])

    const closeMergeDialog = useCallback(() => {
        setMergeDialogState({
            isOpen: false,
            status: 'idle',
            sessionName: null,
            preview: null,
            error: null,
        })
    }, [])

    const confirmMerge = useCallback(
        async (sessionId: string, mode: MergeModeOption, commitMessage?: string) => {
            const preview = mergeDialogStateRef.current.preview

            if (preview?.hasConflicts) {
                setMergeDialogState(prev => {
                    if (!prev.isOpen || prev.sessionName !== sessionId) {
                        return prev
                    }
                    return {
                        ...prev,
                        status: 'ready',
                        error: 'Resolve merge conflicts in the session worktree before merging.',
                    }
                })
                setMergeStatuses(prev => {
                    const next = new Map(prev)
                    next.set(sessionId, 'conflict')
                    return next
                })
                return
            }

            if (preview?.isUpToDate) {
                setMergeDialogState(prev => {
                    if (!prev.isOpen || prev.sessionName !== sessionId) {
                        return prev
                    }
                    return {
                        ...prev,
                        status: 'ready',
                        error: 'Session branch has no commits to merge into the parent branch.',
                    }
                })
                setMergeStatuses(prev => {
                    const next = new Map(prev)
                    next.set(sessionId, 'merged')
                    return next
                })
                return
            }

            setMergeDialogState(prev => {
                if (!prev.isOpen || prev.sessionName !== sessionId) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'running',
                    error: null,
                }
            })

            updateMergeInFlight(sessionId, true)

            try {
                await invoke(TauriCommands.SchaltwerkCoreMergeSessionToMain, {
                    name: sessionId,
                    mode,
                    commitMessage: commitMessage ?? null,
                })
            } catch (error) {
                const message = getErrorMessage(error)
                logger.error('[SessionsContext] Merge command failed:', error)
                updateMergeInFlight(sessionId, false)
                setMergeDialogState(prev => {
                    if (!prev.isOpen || prev.sessionName !== sessionId) {
                        return prev
                    }
                    return {
                        ...prev,
                        status: 'ready',
                        error: message,
                    }
                })
            }
        },
        [updateMergeInFlight, mergeDialogStateRef]
    )

    const updateAutoCancelAfterMerge = useCallback(async (next: boolean, persist: boolean = true) => {
        const previous = autoCancelAfterMergeRef.current
        applyAutoCancelPreference(next)
        if (!persist) {
            return
        }
        try {
            await invoke(TauriCommands.SetProjectMergePreferences, {
                preferences: { auto_cancel_after_merge: next }
            })
        } catch (error) {
            logger.error('[SessionsContext] Failed to update merge preferences:', error)
            applyAutoCancelPreference(previous)
            pushToastRef.current({
                tone: 'error',
                title: 'Failed to update auto-cancel preference',
                description: getErrorMessage(error),
            })
        }
    }, [autoCancelAfterMergeRef, pushToastRef, applyAutoCancelPreference])

    // Note: mapSessionUiState function moved to utils/sessionFilters.ts

    // Sort sessions while preserving object references for unchanged items
    const sortSessionsStable = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        if (sessions.length === 0) return sessions

        // Create a stable reference map to preserve object identity where possible
        const sessionMap = new Map(sessions.map(s => [s.info.session_id, s]))

        // Separate reviewed and unreviewed sessions (matching backend logic)
        const reviewed = sessions.filter(s => s.info.ready_to_merge)
        const unreviewed = sessions.filter(s => !s.info.ready_to_merge)

        // Sort unreviewed sessions by the current sort mode
        const sortedUnreviewed = [...unreviewed].sort((a, b) => {
            switch (sortMode) {
                case SortMode.Name:
                    return a.info.session_id.localeCompare(b.info.session_id)
                case SortMode.Created: {
                    const aCreated = new Date(a.info.created_at || 0).getTime()
                    const bCreated = new Date(b.info.created_at || 0).getTime()
                    return bCreated - aCreated // Newest first
                }
                case SortMode.LastEdited: {
                    const aModified = new Date(a.info.last_modified || 0).getTime()
                    const bModified = new Date(b.info.last_modified || 0).getTime()
                    return bModified - aModified // Most recently edited first
                }
                default:
                    return 0
            }
        })

        // Sort reviewed sessions alphabetically (matching backend logic)
        const sortedReviewed = [...reviewed].sort((a, b) => a.info.session_id.localeCompare(b.info.session_id))

        // Combine: unreviewed first, then reviewed
        const sorted = [...sortedUnreviewed, ...sortedReviewed]

        // Use original object references where possible to prevent unnecessary re-renders
        return sorted.map(s => sessionMap.get(s.info.session_id) || s)
    }, [sortMode])

    // Note: searchSessions function moved to utils/sessionFilters.ts
    const searchSessions = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        return searchSessionsUtil(sessions, searchQuery)
    }, [searchQuery])

    // Filter sessions based on the current filter mode
    const filterSessions = useCallback((sessions: EnrichedSession[]): EnrichedSession[] => {
        switch (filterMode) {
            case FilterMode.All:
                return sessions
            case FilterMode.Spec:
                return sessions.filter(s => mapSessionUiState(s.info) === 'spec')
            case FilterMode.Running:
                return sessions.filter(s => mapSessionUiState(s.info) === 'running')
            case FilterMode.Reviewed:
                return sessions.filter(s => mapSessionUiState(s.info) === 'reviewed')
            default:
                return sessions
        }
    }, [filterMode])

    // Apply search first, then filter mode, then sort
    const searchedSessions = searchSessions(allSessions)
    const filteredSessions = filterSessions(searchedSessions)
    const sortedSessions = sortSessionsStable(filteredSessions)
    
    // Sessions is the final result (searched, filtered, and sorted)
    const sessions = sortedSessions

    // Function to update the current selection (used by SelectionContext)
    const setCurrentSelection = useCallback((sessionId: string | null) => {
        currentSelectionRef.current = sessionId
    }, [])

    const mergeSessionsPreferDraft = useCallback((base: EnrichedSession[], specs: EnrichedSession[]): EnrichedSession[] => {
        const byId = new Map<string, EnrichedSession>()
        for (const s of base) byId.set(s.info.session_id, s)
        for (const d of specs) {
            const existing = byId.get(d.info.session_id)
            if (!existing || mapSessionUiState(existing.info) !== 'spec') byId.set(d.info.session_id, d)
        }
        return Array.from(byId.values())
    }, [])

    const allSessionsRef = useRef<EnrichedSession[]>([])
    useEffect(() => {
        allSessionsRef.current = allSessions
    }, [allSessions])

    const releaseRemovedSessions = useCallback((nextSessions: EnrichedSession[] | null | undefined) => {
        const nextList = Array.isArray(nextSessions) ? nextSessions : []
        const previousIds = new Set(allSessionsRef.current.map(session => session.info.session_id))
        if (previousIds.size === 0) {
            return
        }
        const nextIds = new Set(nextList.map(session => session.info.session_id))
        for (const id of previousIds) {
            if (!nextIds.has(id)) {
                releaseSessionTerminals(id)
            }
        }
    }, [allSessionsRef])

    const reloadInFlightRef = useRef<Promise<void> | null>(null)
    const reloadDirtyRef = useRef(false)

    const autoStartRunningSessions = useCallback((sessions: EnrichedSession[], options?: { reason?: string; previousStates?: Map<string, string> }) => {
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return
        }

        const previousStates = options?.previousStates ?? prevStatesRef.current
        const reason = options?.reason ?? 'sessions-refresh'

        for (const session of sessions) {
            const sessionId = session?.info?.session_id
            if (!sessionId) {
                continue
            }

            const nextState = mapSessionUiState(session.info)
            if (nextState !== 'running') {
                continue
            }

            const wasRunning = previousStates.get(sessionId) === 'running'
            if (wasRunning) {
                continue
            }

            const topId = stableSessionTerminalId(sessionId, 'top')

            if (hasBackgroundStart(topId) || hasInflight(topId)) {
                logger.debug(`[SessionsContext] Skipping auto-start for ${sessionId}; background mark or inflight present (${reason})`)
                continue
            }

            const launch = async () => {
                try {
                    const projectOrchestratorId = computeProjectOrchestratorId(projectPath)
                    const agentType = (session.info.original_agent_type as string | undefined) ?? undefined
                    await startSessionTop({ sessionName: sessionId, topId, projectOrchestratorId, agentType })
                    logger.info(`[SessionsContext] Started agent for ${sessionId} (${reason}).`)
                } catch (error) {
                    const message = getErrorMessage(error)
                    if (message.includes('Permission required for folder:')) {
                        emitUiEvent(UiEvent.PermissionError, { error: message })
                    } else {
                        logger.warn(`[SessionsContext] Auto-start failed for ${sessionId} (${reason}):`, error)
                    }
                }
            }

            void launch()
        }
    }, [projectPath])

    const executeReload = useCallback(async () => {
        if (!projectPath) {
            releaseRemovedSessions([])
            setAllSessions([])
            setLoading(false)
            hasInitialLoadCompleted.current = false
            return
        }

        try {
            if (!hasInitialLoadCompleted.current) {
                setLoading(true)
            }
            const enrichedSessions = await singleflight(
                `list_enriched_sessions:${projectPath}`,
                () => invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions)
            )
            const enriched = enrichedSessions || []
            const previousSessions = new Map(allSessionsRef.current.map(session => [session.info.session_id, session]))

            const attachMergeSnapshot = (session: EnrichedSession): EnrichedSession => {
                const previous = previousSessions.get(session.info.session_id)
                const cached = mergePreviewCacheRef.current.get(session.info.session_id) ?? null
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

            const hasSpecSessions = (sessions: EnrichedSession[]) => {
                return sessions.some(s => mapSessionUiState(s.info) === 'spec')
            }

            if (hasSpecSessions(enriched)) {
                const normalized = enriched.map(attachMergeSnapshot)
                releaseRemovedSessions(normalized)
                setAllSessions(normalized)
                autoStartRunningSessions(normalized, { reason: 'initial-load', previousStates: prevStatesRef.current })
                syncMergeStatuses(normalized)
                const nextStates = new Map<string, string>()
                for (const s of normalized) {
                    nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                }
                prevStatesRef.current = nextStates
            } else {
                let all = enriched.map(attachMergeSnapshot)
                try {
                    const draftSessions = await invoke<RawSession[]>(TauriCommands.SchaltwerkCoreListSessionsByState, { state: SessionState.Spec })

                    const hasValidDraftSessions = (drafts: RawSession[]): boolean => {
                        return Array.isArray(drafts) && drafts.some(d => d && (d.name || d.id))
                    }

                    if (hasValidDraftSessions(draftSessions)) {
                        const enrichDraftSessions = (drafts: RawSession[]): EnrichedSession[] => {
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
                                terminals: []
                            }))
                        }

                        const enrichedDrafts = enrichDraftSessions(draftSessions).map(attachMergeSnapshot)
                        all = mergeSessionsPreferDraft(all, enrichedDrafts)
                    }
                } catch (error) {
                    logger.warn('Failed to fetch draft sessions, continuing with enriched sessions only:', error)
                }

                releaseRemovedSessions(all)
                setAllSessions(all)
                autoStartRunningSessions(all, { reason: 'initial-load', previousStates: prevStatesRef.current })
                syncMergeStatuses(all)
                const nextStates = new Map<string, string>()
                for (const s of all) {
                    nextStates.set(s.info.session_id, mapSessionUiState(s.info))
                }
                prevStatesRef.current = nextStates
            }
        } catch (error) {
            logger.error('Failed to load sessions:', error)
            releaseRemovedSessions([])
            setAllSessions([])
        } finally {
            setLoading(false)
            hasInitialLoadCompleted.current = true
        }
    }, [projectPath, mergeSessionsPreferDraft, syncMergeStatuses, autoStartRunningSessions, releaseRemovedSessions])

    const reloadSessions = useCallback(() => {
        if (reloadInFlightRef.current) {
            reloadDirtyRef.current = true
            return reloadInFlightRef.current
        }

        const promise = (async () => {
            try {
                await executeReload()
            } finally {
                const shouldReplay = reloadDirtyRef.current
                reloadDirtyRef.current = false
                reloadInFlightRef.current = null
                if (shouldReplay) {
                    void reloadSessions()
                }
            }
        })()

        reloadInFlightRef.current = promise
        return promise
    }, [executeReload])

    const optimisticallyConvertSessionToSpec = useCallback((sessionId: string) => {
        let updated = false
        setAllSessions(prev => {
            let changed = false
            const next = prev.map(session => {
                if (session.info.session_id !== sessionId) {
                    return session
                }
                changed = true
                const nextInfo: SessionInfo = {
                    ...session.info,
                    session_state: 'spec',
                    status: 'spec',
                    ready_to_merge: false,
                    has_uncommitted_changes: false,
                    has_conflicts: false,
                    diff_stats: undefined,
                    merge_has_conflicts: undefined,
                    merge_conflicting_paths: undefined,
                    merge_is_up_to_date: undefined,
                }
                return {
                    ...session,
                    info: nextInfo,
                }
            })

            if (!changed) {
                return prev
            }

            updated = true
            return next
        })

        if (!updated) {
            logger.debug(`[SessionsContext] Optimistic convert skipped; session ${sessionId} not found`)
            return
        }

        prevStatesRef.current.set(sessionId, 'spec')
        setMergeStatuses(prev => {
            if (!prev.has(sessionId)) {
                return prev
            }
            const next = new Map(prev)
            next.delete(sessionId)
            return next
        })
    }, [])

    useEffect(() => {
        if (!projectPath) {
            return
        }

        const readySessions = allSessions.filter(session => session.info.ready_to_merge)
        readySessions.forEach(session => {
            const sessionId = session.info.session_id
            if (pendingMergePreviewRef.current.has(sessionId)) {
                return
            }

            const cachedPreview = mergePreviewCacheRef.current.get(sessionId)
            const hasSnapshot = typeof session.info.merge_has_conflicts === 'boolean'
                || typeof session.info.merge_is_up_to_date === 'boolean'
                || (Array.isArray(session.info.merge_conflicting_paths) && session.info.merge_conflicting_paths.length > 0)
                || Boolean(cachedPreview)

            if (hasSnapshot) {
                return
            }

            pendingMergePreviewRef.current.add(sessionId)

            Promise.resolve(
                invoke<MergePreviewResponse | null | undefined>(
                    TauriCommands.SchaltwerkCoreGetMergePreview,
                    { name: sessionId }
                )
            ).then(preview => {
                    mergePreviewCacheRef.current.set(sessionId, preview ?? null)

                    if (!preview) {
                        return
                    }

                    setAllSessions(prev => prev.map(existing => {
                        if (existing.info.session_id !== sessionId) {
                            return existing
                        }
                        return {
                            ...existing,
                            info: {
                                ...existing.info,
                                merge_has_conflicts: preview.hasConflicts,
                                merge_conflicting_paths: preview.conflictingPaths.length ? preview.conflictingPaths : existing.info.merge_conflicting_paths,
                                merge_is_up_to_date: preview.isUpToDate,
                            },
                        }
                    }))
                    setMergeStatuses(prev => {
                        const next = new Map(prev)
                        if (preview.hasConflicts) {
                            next.set(sessionId, 'conflict')
                        } else if (preview.isUpToDate) {
                            next.set(sessionId, 'merged')
                        } else {
                            next.delete(sessionId)
                        }
                        return next
                    })
                })
                .catch(error => {
                    logger.warn('[SessionsContext] Failed to prefetch merge preview:', error)
                })
                .finally(() => {
                    pendingMergePreviewRef.current.delete(sessionId)
                })
        })
    }, [allSessions, projectPath])

    useEffect(() => {
        let cancelled = false

        if (!projectPath) {
            applyAutoCancelPreference(true)
            return
        }

        ;(async () => {
            try {
                const preferences = await invoke<{ auto_cancel_after_merge: boolean }>(
                    TauriCommands.GetProjectMergePreferences
                )
                if (!cancelled) {
                    applyAutoCancelPreference(preferences?.auto_cancel_after_merge !== false)
                }
            } catch (error) {
                logger.error('[SessionsContext] Failed to load merge preferences:', error)
                if (!cancelled) {
                    applyAutoCancelPreference(true)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [projectPath, applyAutoCancelPreference])

    // Ensure a backend watcher is active for each running session so git stats update instantly
    // Note: file watchers are managed per active selection in SelectionContext to
    // avoid global watcher churn from the UI layer.

    const updateSessionStatus = useCallback(async (sessionId: string, newStatus: string) => {
        try {
            const currentSessions = await singleflight(
                `list_enriched_sessions:${projectPath}`,
                () => invoke<EnrichedSession[]>(TauriCommands.SchaltwerkCoreListEnrichedSessions)
            )
            const session = currentSessions?.find(s => s.info.session_id === sessionId)

            if (!session) {
                logger.error(`Session ${sessionId} not found`)
                return
            }

            if (newStatus === 'spec') {
                await invoke(TauriCommands.SchaltwerkCoreConvertSessionToDraft, { name: sessionId })
            } else if (newStatus === 'active') {
                if (session.info.status === 'spec') {
                    await invoke(TauriCommands.SchaltwerkCoreStartSpecSession, { name: sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke(TauriCommands.SchaltwerkCoreUnmarkReady, { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                await invoke(TauriCommands.SchaltwerkCoreMarkReady, { name: sessionId })
            }

            await reloadSessions()
        } catch (error) {
            logger.error('Failed to update session status:', error)
        }
    }, [projectPath, reloadSessions])

    const createDraft = useCallback(async (name: string, content: string) => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreCreateSpecSession, { name, specContent: content })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to create spec:', error)
            throw error
        }
    }, [reloadSessions])

    // Load sort/filter settings when project changes
    useEffect(() => {
        if (!projectPath) {
            setSettingsLoaded(false)
            return
        }
        
        const loadProjectSettings = async () => {
            try {
                const settings = await invoke<{ filter_mode: string; sort_mode: string }>(TauriCommands.GetProjectSessionsSettings)
                if (settings) {
                    // Validate and set filter mode with fallback
                    const filterMode = isValidFilterMode(settings.filter_mode) 
                        ? settings.filter_mode as FilterMode
                        : getDefaultFilterMode()
                    setFilterMode(filterMode)
                    
                    // Validate and set sort mode with fallback
                    const sortMode = isValidSortMode(settings.sort_mode)
                        ? settings.sort_mode as SortMode
                        : getDefaultSortMode()
                    setSortMode(sortMode)
                }
                setSettingsLoaded(true)
            } catch (error) {
                logger.warn('Failed to load project sessions settings:', error)
                setSettingsLoaded(true)
            }
        }
        
        loadProjectSettings()
    }, [projectPath])

    // Save settings when they change
    useEffect(() => {
        if (!settingsLoaded || !projectPath) return
        
        const saveSettings = async () => {
            try {
                await invoke(TauriCommands.SetProjectSessionsSettings, { 
                    settings: {
                        filter_mode: filterMode,
                        sort_mode: sortMode
                    }
                })
            } catch (error) {
                logger.warn('Failed to save sessions settings:', error)
            }
        }
        
        saveSettings()
    }, [sortMode, filterMode, settingsLoaded, projectPath])

    useEffect(() => {
        // Only reload sessions when projectPath actually changes
        if (projectPath !== lastProjectPath) {
            setLastProjectPath(projectPath)
            hasInitialLoadCompleted.current = false
            if (projectPath) {
                reloadSessions()
            } else {
                setAllSessions([])
                setLoading(false)
            }
        }
    }, [projectPath, lastProjectPath, reloadSessions])

    useEffect(() => {
        let disposed = false
        const unlisteners: UnlistenFn[] = []

        const register = <E extends SchaltEvent>(
            event: E,
            handler: (payload: EventPayloadMap[E]) => void | Promise<void>
        ) => {
            const promise = listenEvent(event, async (payload) => {
                if (disposed) return
                await handler(payload)
            })

            promise
                .then(unlisten => {
                    if (disposed) {
                        unlisten()
                        return
                    }
                    unlisteners.push(unlisten)
                })
                .catch(error => {
                    logger.error(`[SessionsContext] Failed to register listener for ${event}:`, error)
                })
        }

        register(SchaltEvent.SessionsRefreshed, async (event) => {
            try {
                if (event && event.length > 0) {
                    let updatedSessionIds: string[] | null = null
                    let updatedSnapshot: EnrichedSession[] | null = null;
                    setAllSessions(prev => {
                        const newSessionsMap = new Map<string, EnrichedSession>()
                        for (const session of event) {
                            newSessionsMap.set(session.info.session_id, session)
                        }

                        const updated: EnrichedSession[] = []
                        const seenIds = new Set<string>()

                        for (const existing of prev) {
                            const newSession = newSessionsMap.get(existing.info.session_id)
                            if (newSession) {
                                if (!areSessionInfosEqual(existing.info, newSession.info)) {
                                    updated.push(newSession)
                                } else {
                                    updated.push(existing)
                                }
                                seenIds.add(existing.info.session_id)
                            }
                        }

                        for (const newSession of event) {
                            const sessionId = newSession.info.session_id
                            if (seenIds.has(sessionId)) {
                                continue
                            }
                            seenIds.add(sessionId)
                            updated.push(newSession)
                        }

                        if (updated.length === prev.length &&
                            updated.every((s, i) => s === prev[i])) {
                            updatedSnapshot = null;
                            return prev
                        }

                        updatedSnapshot = updated
                        updatedSessionIds = updated.map(session => session.info.session_id)
                        return updated
                    })

                    if (updatedSnapshot) {
                        releaseRemovedSessions(updatedSnapshot)
                    }

                    const previousStatesSnapshot = new Map(prevStatesRef.current)
                    autoStartRunningSessions(event, { reason: 'sessions-refreshed', previousStates: previousStatesSnapshot })

                    const mergedStates = new Map(previousStatesSnapshot)
                    const payloadIds = new Set<string>()
                    for (const session of event) {
                        const sessionId = session.info.session_id
                        const nextState = mapSessionUiState(session.info)
                        mergedStates.set(sessionId, nextState)
                        payloadIds.add(sessionId)
                    }

                    if (Array.isArray(updatedSessionIds)) {
                        const updatedIds = updatedSessionIds as string[]
                        const isFullSnapshot = payloadIds.size === event.length
                            && updatedIds.length === event.length
                            && updatedIds.every(id => payloadIds.has(id))

                        if (isFullSnapshot) {
                            for (const knownId of Array.from(mergedStates.keys())) {
                                if (!payloadIds.has(knownId)) {
                                    mergedStates.delete(knownId)
                                }
                            }
                        }
                    }

                    prevStatesRef.current = mergedStates

                    syncMergeStatuses(event)
                } else {
                    if (!pendingSessionsReloadRef.current) {
                        pendingSessionsReloadRef.current = true
                        void reloadSessions()
                            .catch(error => {
                                logger.warn('[SessionsContext] Failed to reload after empty SessionsRefreshed payload:', error)
                            })
                            .finally(() => {
                                pendingSessionsReloadRef.current = false
                            })
                    } else {
                        logger.debug('[SessionsContext] Skipping duplicate reload for empty SessionsRefreshed payload')
                    }
                }
            } catch (e) {
                logger.error('[SessionsContext] Failed to process SessionsRefreshed event:', e)
            }
        })

        register(SchaltEvent.SessionActivity, (event) => {
            const { session_name, last_activity_ts, current_task, todo_percentage, is_blocked } = event
            setAllSessions(prev => prev.map(s => {
                if (s.info.session_id !== session_name) return s
                return {
                    ...s,
                    info: {
                        ...s.info,
                        last_modified: new Date(last_activity_ts * 1000).toISOString(),
                        last_modified_ts: last_activity_ts * 1000,
                        current_task: current_task || s.info.current_task,
                        todo_percentage: todo_percentage || s.info.todo_percentage,
                        is_blocked: is_blocked || s.info.is_blocked,
                    }
                }
            }))
        })

        register(SchaltEvent.TerminalAttention, (event) => {
            const { session_id, terminal_id, needs_attention } = event
            if (!isTopTerminalId(terminal_id)) {
                logger.debug('[SessionsContext] Ignoring idle event from non-top terminal', event)
                return
            }
            setAllSessions(prev => {
                const targetIndex = prev.findIndex(s => s.info.session_id === session_id)
                if (targetIndex === -1) return prev

                const target = prev[targetIndex]
                const newValue = needs_attention ? true : undefined

                if (target.info.attention_required === newValue) return prev

                const updated = [...prev]
                updated[targetIndex] = {
                    ...target,
                    info: {
                        ...target.info,
                        attention_required: newValue
                    }
                }
                return updated
            })
        })

        register(SchaltEvent.SessionGitStats, (event) => {
            logger.debug('[SessionsContext] SessionGitStats event', event)
            const {
                session_name,
                files_changed,
                lines_added,
                lines_removed,
                has_uncommitted,
                has_conflicts = false,
                top_uncommitted_paths,
                merge_has_conflicts,
                merge_is_up_to_date,
                merge_conflicting_paths,
                worktree_size_bytes,
            } = event
            setAllSessions(prev => prev.map(s => {
                if (s.info.session_id !== session_name) return s
                const diff = {
                    files_changed: files_changed || 0,
                    additions: lines_added || 0,
                    deletions: lines_removed || 0,
                    insertions: lines_added || 0,
                }
                logger.debug('[SessionsContext] Applying git stats', { session: session_name, diff, has_uncommitted, has_conflicts })
                return {
                    ...s,
                    info: {
                        ...s.info,
                        diff_stats: diff,
                        has_uncommitted_changes: has_uncommitted,
                        has_conflicts,
                        top_uncommitted_paths: top_uncommitted_paths && top_uncommitted_paths.length ? top_uncommitted_paths : undefined,
                        merge_has_conflicts: merge_has_conflicts ?? s.info.merge_has_conflicts,
                        merge_conflicting_paths: merge_conflicting_paths && merge_conflicting_paths.length ? merge_conflicting_paths : s.info.merge_conflicting_paths,
                        merge_is_up_to_date: typeof merge_is_up_to_date === 'boolean' ? merge_is_up_to_date : s.info.merge_is_up_to_date,
                        worktree_size_bytes: typeof worktree_size_bytes === 'number' ? worktree_size_bytes : s.info.worktree_size_bytes,
                    }
                }
            }))

            const mergeConflictFlag = typeof merge_has_conflicts === 'boolean' ? merge_has_conflicts : undefined
            const mergeUpToDateFlag = typeof merge_is_up_to_date === 'boolean' ? merge_is_up_to_date : undefined

            setMergeStatuses(prev => {
                const next = new Map(prev)
                if (mergeConflictFlag === true || (mergeConflictFlag === undefined && has_conflicts)) {
                    next.set(session_name, 'conflict')
                } else if (mergeConflictFlag === false || (!has_conflicts && mergeConflictFlag === undefined)) {
                    if (next.get(session_name) === 'conflict') {
                        next.delete(session_name)
                    }
                }

                if (mergeUpToDateFlag === true) {
                    const current = next.get(session_name)
                    if (current !== 'merged') {
                        next.set(session_name, 'merged')
                    }
                } else if (mergeUpToDateFlag === false) {
                    if (next.get(session_name) === 'merged') {
                        next.delete(session_name)
                    }
                } else if (mergeConflictFlag === undefined) {
                    const noDiff = (files_changed || 0) === 0 && !has_uncommitted && !has_conflicts
                    if (noDiff) {
                        next.set(session_name, 'merged')
                    } else if (next.get(session_name) === 'merged' && !noDiff) {
                        next.delete(session_name)
                    }
                }

                return next
            })
        })

        register(SchaltEvent.SessionAdded, (event) => {
            const { session_name, branch, worktree_path, parent_branch } = event
            const nowIso = new Date().toISOString()
            const createdAt = event.created_at ?? nowIso
            const lastModified = event.last_modified ?? createdAt
            setAllSessions(prev => {
                if (prev.some(s => s.info.session_id === session_name)) return prev

                const info: SessionInfo = {
                    session_id: session_name,
                    branch,
                    worktree_path,
                    base_branch: parent_branch,
                    parent_branch,
                    status: 'active',
                    created_at: createdAt,
                    last_modified: lastModified,
                    has_uncommitted_changes: false,
                    has_conflicts: false,
                    is_current: false,
                    session_type: 'worktree',
                    container_status: undefined,
                    session_state: 'running',
                    current_task: undefined,
                    todo_percentage: undefined,
                    is_blocked: undefined,
                    diff_stats: undefined,
                    ready_to_merge: false,
                }
                const terminals = [
                    stableSessionTerminalId(session_name, 'top'),
                    stableSessionTerminalId(session_name, 'bottom')
                ]
                const enriched: EnrichedSession = { info, status: undefined, terminals }
                return [enriched, ...prev]
            })

            ;(async () => {
                const topId = stableSessionTerminalId(session_name, 'top')

                if (hasBackgroundStart(topId) || hasInflight(topId)) {
                    logger.debug(`[SessionsContext] Skip auto-start; mark or inflight present for ${topId}`)
                    return
                }

                try {
                    const projectOrchestratorId = computeProjectOrchestratorId(projectPath)
                    await startSessionTop({ sessionName: session_name, topId, projectOrchestratorId })
                    logger.info(`[SessionsContext] Started agent for ${session_name} (auto-start).`)
                } catch (error) {
                    const message = String(error)
                    if (message.includes('Permission required for folder:')) {
                        emitUiEvent(UiEvent.PermissionError, { error: message })
                    } else {
                        logger.warn('[SessionsContext] Auto-start for new session failed:', error)
                    }
                }
            })()
        })

        register(SchaltEvent.SessionCancelling, (event) => {
            setAllSessions(prev => prev.map(s => {
                if (s.info.session_id !== event.session_name) return s
                return {
                    ...s,
                    info: {
                        ...s.info,
                        status: 'spec'
                    }
                }
            }))
        })

        register(SchaltEvent.SessionRemoved, (event) => {
            let removed = false
            setAllSessions(prev => {
                const exists = prev.some(s => s.info.session_id === event.session_name)
                if (!exists) {
                    removed = false
                    return prev
                }
                removed = true
                return prev.filter(s => s.info.session_id !== event.session_name)
            })
            if (removed) {
                releaseSessionTerminals(event.session_name)
            }
            prevStatesRef.current.delete(event.session_name)
            setSessionMutations(prev => {
                if (!prev.has(event.session_name)) {
                    return prev
                }
                const next = new Map(prev)
                next.delete(event.session_name)
                return next
            })
        })

        return () => {
            disposed = true
            unlisteners.forEach(unlisten => {
                try {
                    unlisten()
                } catch (error) {
                    logger.debug('[SessionsContext] Failed to cleanup listener:', error)
                }
            })
            unlisteners.length = 0
        }
    }, [projectPath, reloadSessions, syncMergeStatuses, autoStartRunningSessions, releaseRemovedSessions])


    useEffect(() => {
        let disposed = false
        const cleanups: Array<() => void> = []

        const register = <E extends SchaltEvent>(event: E, handler: (payload: EventPayloadMap[E]) => void) => {
            listenEvent(event, (payload) => {
                if (!disposed) {
                    handler(payload)
                }
            })
                .then(unlisten => {
                    if (disposed) {
                        unlisten()
                        return
                    }
                    cleanups.push(unlisten)
                })
                .catch(error => {
                    logger.error(`[SessionsContext] Failed to register listener for ${event}:`, error)
                })
        }

        const handleStarted = (event: GitOperationPayload) => {
            mergeErrorCacheRef.current.delete(event.session_name)
            updateMergeInFlightRef.current(event.session_name, true)
            setMergeStatuses(prev => {
                if (!prev.has(event.session_name)) {
                    return prev
                }
                const next = new Map(prev)
                next.delete(event.session_name)
                return next
            })
            setMergeDialogState(prev => {
                if (!prev.isOpen || prev.sessionName !== event.session_name) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'running',
                    error: null,
                }
            })
        }

        const handleCompleted = (event: GitOperationPayload) => {
            updateMergeInFlightRef.current(event.session_name, false)
            mergeErrorCacheRef.current.delete(event.session_name)
            setMergeStatuses(prev => {
                const next = new Map(prev)
                next.set(event.session_name, 'merged')
                return next
            })

            const shortCommit = event.commit ? event.commit.slice(0, 7) : undefined
            const description = shortCommit
                ? `Fast-forwarded ${event.parent_branch} to ${shortCommit}`
                : `Fast-forwarded ${event.parent_branch}`

            pushToastRef.current({
                tone: 'success',
                title: `Merged ${event.session_name}`,
                description,
            })

            if ((event.status === 'success' || event.status === undefined) && event.operation === 'merge' && autoCancelAfterMergeRef.current) {
                void (async () => {
                    try {
                        await invoke(TauriCommands.SchaltwerkCoreCancelSession, { name: event.session_name })
                    } catch (error) {
                        logger.error('[SessionsContext] Auto-cancel after merge failed:', error)
                        pushToastRef.current({
                            tone: 'error',
                            title: `Failed to cancel ${event.session_name}`,
                            description: getErrorMessage(error),
                        })
                    }
                })()
            }

            setMergeDialogState(prev => {
                if (!prev.isOpen || prev.sessionName !== event.session_name) {
                    return prev
                }
                return {
                    isOpen: false,
                    status: 'idle',
                    sessionName: null,
                    preview: null,
                    error: null,
                }
            })
        }

        const handleFailed = (event: GitOperationFailedPayload) => {
            updateMergeInFlightRef.current(event.session_name, false)
            const previousError = mergeErrorCacheRef.current.get(event.session_name)
            if (!previousError || previousError !== event.error) {
                mergeErrorCacheRef.current.set(event.session_name, event.error)
                pushToastRef.current({
                    tone: 'error',
                    title: `Merge failed for ${event.session_name}`,
                    description: event.error,
                })
            }

            if (event.status === 'conflict') {
                setMergeStatuses(prev => {
                    const next = new Map(prev)
                    next.set(event.session_name, 'conflict')
                    return next
                })
            }

            setMergeDialogState(prev => {
                if (!prev.isOpen || prev.sessionName !== event.session_name) {
                    return prev
                }
                return {
                    ...prev,
                    status: 'ready',
                    error: event.error ?? 'Merge failed',
                }
            })
        }

        register(SchaltEvent.GitOperationStarted, handleStarted)
        register(SchaltEvent.GitOperationCompleted, handleCompleted)
        register(SchaltEvent.GitOperationFailed, handleFailed)

        return () => {
            disposed = true
            cleanups.forEach(cleanup => {
                try {
                    cleanup()
                } catch (error) {
                    logger.error('[SessionsContext] Failed to cleanup Git operation listener:', error)
                }
            })
        }
    }, [pushToastRef, updateMergeInFlightRef, autoCancelAfterMergeRef])

    return (
        <SessionsContext.Provider value={{
            sessions,
            allSessions,
            filteredSessions,
            sortedSessions,
            loading,
            sortMode,
            filterMode,
            searchQuery,
            isSearchVisible,
            setSortMode,
            setFilterMode,
            setSearchQuery,
            setIsSearchVisible,
            setCurrentSelection,
            reloadSessions,
            optimisticallyConvertSessionToSpec,
            updateSessionStatus,
            createDraft,
            mergeDialogState,
            openMergeDialog,
            closeMergeDialog,
            confirmMerge,
            isMergeInFlight,
            getMergeStatus,
            autoCancelAfterMerge,
            updateAutoCancelAfterMerge,
            beginSessionMutation,
            endSessionMutation,
            isSessionMutating,
        }}>
            {children}
        </SessionsContext.Provider>
    )
}

export function useSessions() {
    const context = useContext(SessionsContext)
    if (!context) {
        throw new Error('useSessions must be used within SessionsProvider')
    }
    return context
}
