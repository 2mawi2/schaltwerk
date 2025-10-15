import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'
import { useProject } from './ProjectContext'
import { useFontSize } from './FontSizeContext'
import { useSessions } from './SessionsContext'
import { FilterMode } from '../types/sessionFilters'
import { RawSession, EnrichedSession } from '../types/session'
import { logger } from '../utils/logger'
import { useModal } from './ModalContext'
import { UiEvent, emitUiEvent, listenUiEvent } from '../common/uiEvents'
import {
    createTerminalBackend,
    terminalExistsBackend,
    closeTerminalBackend,
} from '../terminal/transport/backend'
import { sessionTerminalGroup } from '../common/terminalIdentity'

type NormalizedSessionState = 'spec' | 'running' | 'reviewed'

interface SessionSnapshot {
    sessionId: string
    sessionState: NormalizedSessionState
    worktreePath?: string
    branch?: string
    readyToMerge?: boolean
    source: 'enriched' | 'raw'
}

function normalizeSessionState(
    sessionState?: string | null,
    status?: string,
    readyToMerge?: boolean
): NormalizedSessionState {
    if (sessionState === 'spec' || sessionState === 'running' || sessionState === 'reviewed') {
        return sessionState
    }
    if (status === 'spec') {
        return 'spec'
    }
    if (readyToMerge) {
        return 'reviewed'
    }
    return 'running'
}

function snapshotFromRawSession(raw: RawSession): SessionSnapshot {
    const normalized = normalizeSessionState(raw.session_state, raw.status, raw.ready_to_merge)
    return {
        sessionId: raw.name,
        sessionState: normalized,
        worktreePath: raw.worktree_path,
        branch: raw.branch,
        readyToMerge: raw.ready_to_merge,
        source: 'raw'
    }
}

function snapshotFromEnrichedSession(session: EnrichedSession): SessionSnapshot {
    const info = session.info
    const normalized = normalizeSessionState(info.session_state, info.status, info.ready_to_merge)
    return {
        sessionId: info.session_id,
        sessionState: normalized,
        worktreePath: info.worktree_path,
        branch: info.branch,
        readyToMerge: info.ready_to_merge,
        source: 'enriched'
    }
}

export interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    worktreePath?: string
    sessionState?: 'spec' | 'running' | 'reviewed'  // Pass from Sidebar to avoid async fetch
}

interface TerminalSet {
    top: string
    bottomBase: string
    workingDirectory: string
}

interface SelectionContextType {
    selection: Selection
    terminals: TerminalSet
    setSelection: (selection: Selection, forceRecreate?: boolean, isIntentional?: boolean) => Promise<void>
    clearTerminalTracking: (terminalIds: string[]) => Promise<void>
    isReady: boolean
    isSpec: boolean
}

const SelectionContext = createContext<SelectionContextType>({
    selection: { kind: 'orchestrator' },
    terminals: { top: 'orchestrator-default-top', bottomBase: 'orchestrator-default-bottom', workingDirectory: '' },
    setSelection: async () => { throw new Error('SelectionProvider not mounted') },
    clearTerminalTracking: async () => {},
    isReady: false,
    isSpec: false,
})

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const { projectPath } = useProject()
    const { terminalFontSize: _terminalFontSize } = useFontSize()
    const { setCurrentSelection, filterMode, allSessions } = useSessions()
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-default-top',
        bottomBase: 'orchestrator-default-bottom',
        workingDirectory: ''
    })
    // Start as not ready, will become ready once we have initialized with a project
    const [isReady, setIsReady] = useState(false)
    const [isSpecState, setIsSpecState] = useState(false)
    const isSpec = selection.kind === 'session' && selection.sessionState === 'spec'
        ? true
        : isSpecState
    const previousProjectPath = useRef<string | null>(null)
    const hasInitialized = useRef(false)
    // Project epoch and user selection marker to arbitrate auto-restore vs user selection
    const projectEpochRef = useRef(0)
    const lastUserSelectionEpochRef = useRef(-1)
    const userSelectionInFlightRef = useRef(false)
    // Track metadata without attaching fields to the function reference
    const lastTokenWasAutoRef = useRef(false)
    const lastUserTokenRef = useRef(0)
    const { isAnyModalOpen, openModals } = useModal()
    const pendingSelectionRef = useRef<Selection | null>(null)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())

    // Cache for expensive project ID calculations
    const projectIdCache = useRef<string | null>(null)
    const cachedProjectPath = useRef<string | null>(null)

    const isRestoringRef = useRef(false)
    // Monotonic token to ignore out-of-order async completions
    const selectionTokenRef = useRef(0)
    // Tracks user-intent selections to avoid auto-restore overriding explicit user actions
    const lastIntentionalRef = useRef(0)
    const suppressAutoRestoreRef = useRef(false)
    const ORCHESTRATOR_SESSION_ID = 'orchestrator'
    // Track active file watcher session to switch watchers on selection change
    const lastWatchedSessionRef = useRef<string | null>(null)
    const orchestratorWatcherActiveRef = useRef(false)
    useEffect(() => {
        const cache = sessionSnapshotsRef.current
        const seen = new Set<string>()
        for (const session of allSessions) {
            const snapshot = snapshotFromEnrichedSession(session)
            cache.set(snapshot.sessionId, snapshot)
            seen.add(snapshot.sessionId)
        }
        for (const key of Array.from(cache.keys())) {
            if (!seen.has(key) && !sessionFetchPromisesRef.current.has(key)) {
                cache.delete(key)
            }
        }
    }, [allSessions])
    const sessionSnapshotsRef = useRef(new Map<string, SessionSnapshot>())
    const latestSessionsRef = useRef<EnrichedSession[]>([])
    useEffect(() => { latestSessionsRef.current = allSessions }, [allSessions])
    const sessionFetchPromisesRef = useRef(new Map<string, Promise<SessionSnapshot | null>>())
    const lastSelectionByProjectRef = useRef(new Map<string, Selection>())

    const rememberSelection = useCallback((sel: Selection) => {
        if (!projectPath) {
            return
        }
        lastSelectionByProjectRef.current.set(projectPath, { ...sel })
    }, [projectPath])

    // Helper: finalize a selection change by removing the switching class and notifying listeners
    const finalizeSelectionChange = useCallback((sel: Selection) => {
        const doFinalize = () => {
            document.body.classList.remove('session-switching')
            rememberSelection(sel)
            try {
                if (sel.kind === 'session' && sel.payload) {
                    emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'session', sessionId: sel.payload })
                } else {
                    emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'orchestrator' })
                }
            } catch (e) {
                logger.warn('[SelectionContext] Failed to dispatch selection resize event', e)
            }

            // Also request a generic terminal resize so all terminals recompute cols/rows deterministically
            try {
                if (sel.kind === 'session' && sel.payload) {
                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sel.payload })
                } else {
                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
                }
            } catch (e) {
                logger.warn('[SelectionContext] Failed to dispatch generic terminal resize request', e)
            }
        }
        const isTestEnv = typeof process !== 'undefined' && (process as unknown as { env?: Record<string, string> }).env?.NODE_ENV === 'test'
        if (isTestEnv) doFinalize()
        else requestAnimationFrame(doFinalize)
    }, [rememberSelection])
    
    // Get terminal IDs for a selection
    // Helper function to get cached project ID
    const getCachedProjectId = useCallback((path: string | null): string => {
        if (path === cachedProjectPath.current) {
            return projectIdCache.current || 'default'
        }

        cachedProjectPath.current = path

        if (!path) {
            projectIdCache.current = 'default'
            return 'default'
        }

        // Get just the last directory name and combine with a hash for uniqueness
        const dirName = path.split(/[/\\]/).pop() || 'unknown'
        // Sanitize directory name: replace spaces and special chars with underscores
        const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
        // Simple hash: sum of char codes
        let hash = 0
        for (let i = 0; i < path.length; i++) {
            hash = ((hash << 5) - hash) + path.charCodeAt(i)
            hash = hash & hash // Convert to 32bit integer
        }
        const projectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
        projectIdCache.current = projectId
        return projectId
    }, [])

    const getTerminalIds = useCallback((sel: Selection): TerminalSet => {
        let workingDir = projectPath || ''

        if (sel.kind === 'orchestrator') {
            // Make orchestrator terminals project-specific by using project path hash
            // Use cached project ID to avoid recalculating expensive hash
            const projectId = getCachedProjectId(projectPath)
            const base = `orchestrator-${projectId}`
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: workingDir
            }
        } else {
            const group = sessionTerminalGroup(sel.payload)
            const sessionWorkingDir = sel.sessionState === 'running' && sel.worktreePath ? sel.worktreePath : ''
            return {
                top: group.top,
                bottomBase: group.bottomBase,
                workingDirectory: sessionWorkingDir
            }
        }
    }, [projectPath, getCachedProjectId])

    const getCachedSessionSnapshot = useCallback((sessionId?: string | null): SessionSnapshot | null => {
        if (!sessionId) return null
        return sessionSnapshotsRef.current.get(sessionId) ?? null
    }, [])

    const ensureSessionSnapshot = useCallback(async (
        sessionId?: string | null,
        options: { refresh?: boolean } = {}
    ): Promise<SessionSnapshot | null> => {
        if (!sessionId) return null

        if (!options.refresh) {
            const cached = sessionSnapshotsRef.current.get(sessionId)
            if (cached) return cached
        } else {
            sessionSnapshotsRef.current.delete(sessionId)
        }

        if (options.refresh) {
            sessionFetchPromisesRef.current.delete(sessionId)
        } else {
            const inFlight = sessionFetchPromisesRef.current.get(sessionId)
            if (inFlight) {
                return inFlight
            }
        }

        const fetchPromise = (async () => {
            try {
                const raw = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionId })
                if (!raw) {
                    return null
                }
                const snapshot = snapshotFromRawSession(raw)
                sessionSnapshotsRef.current.set(sessionId, snapshot)
                return snapshot
            } catch (error) {
                logger.warn('[SelectionContext] Failed to fetch session snapshot', error)
                return null
            } finally {
                sessionFetchPromisesRef.current.delete(sessionId)
            }
        })()

        sessionFetchPromisesRef.current.set(sessionId, fetchPromise)
        return fetchPromise
    }, [])

    const computeSessionParams = useCallback((sel: Selection) => {
        if (!projectPath) return null
        if (sel.kind === 'session') {
            const sessionId = sel.payload ?? null
            if (!sessionId) return null
            return { projectId: projectPath, sessionId }
        }
        if (sel.kind === 'orchestrator') {
            return { projectId: projectPath, sessionId: null }
        }
        return null
    }, [projectPath])

    const registerTerminalsForSelection = useCallback(async (terminalIds: string[], sel: Selection) => {
        if (terminalIds.length === 0) return
        const params = computeSessionParams(sel)
        if (!params) return
        try {
            await invoke(TauriCommands.RegisterSessionTerminals, {
                projectId: params.projectId,
                sessionId: params.sessionId,
                terminalIds,
            })
        } catch (error) {
            logger.warn('[SelectionContext] Failed to register terminals for session', error)
        }
    }, [computeSessionParams])

    const suspendTerminalsForSelection = useCallback(async (sel: Selection) => {
        const params = computeSessionParams(sel)
        if (!params) return
        try {
            await invoke(TauriCommands.SuspendSessionTerminals, {
                projectId: params.projectId,
                sessionId: params.sessionId,
            })
        } catch (error) {
            logger.warn('[SelectionContext] Failed to suspend terminals for selection', error)
        }
    }, [computeSessionParams])

    const resumeTerminalsForSelection = useCallback(async (sel: Selection) => {
        const params = computeSessionParams(sel)
        if (!params) return
        try {
            await invoke(TauriCommands.ResumeSessionTerminals, {
                projectId: params.projectId,
                sessionId: params.sessionId,
            })
        } catch (error) {
            logger.warn('[SelectionContext] Failed to resume terminals for selection', error)
        }
    }, [computeSessionParams])

    // Create a single terminal with deduplication
    const createTerminal = useCallback(async (id: string, cwd: string) => {
        // If already created, skip
        if (terminalsCreated.current.has(id)) {
            return
        }
        
        // If already creating, wait for that to finish
        if (creationLock.current.has(id)) {
            await creationLock.current.get(id)
            return
        }
        
        // Create promise for this creation
        const createPromise = (async () => {
            try {
                const exists = await terminalExistsBackend(id)
                if (!exists) {
                    await createTerminalBackend({ id, cwd })
                }
                terminalsCreated.current.add(id)
            } catch (error) {
                logger.error(`Failed to create terminal ${id}:`, error)
                throw error
            }
        })()
        
        // Store promise so others can wait
        creationLock.current.set(id, createPromise)
        
        try {
            await createPromise
        } finally {
            creationLock.current.delete(id)
        }
    }, [])

    const resolveSessionState = useCallback((options: {
        sessionId?: string | null
        desiredState?: NormalizedSessionState | null
        snapshot: SessionSnapshot | null
    }): { state: NormalizedSessionState; snapshot: SessionSnapshot | null } => {
        const { sessionId, desiredState, snapshot } = options

        if (desiredState === 'spec') {
            return { state: 'spec', snapshot }
        }

        let finalSnapshot = snapshot

        if (sessionId) {
            const enriched = latestSessionsRef.current.find(s => s.info.session_id === sessionId)
            if (enriched) {
                const enrichedSnapshot = snapshotFromEnrichedSession(enriched)
                sessionSnapshotsRef.current.set(sessionId, enrichedSnapshot)
                finalSnapshot = finalSnapshot ?? enrichedSnapshot
                if (enrichedSnapshot.sessionState === 'spec') {
                    return { state: 'spec', snapshot: enrichedSnapshot }
                }
                if (!desiredState && !snapshot?.sessionState && enrichedSnapshot.sessionState) {
                    return { state: enrichedSnapshot.sessionState, snapshot: enrichedSnapshot }
                }
            }
        }

        if (desiredState) {
            return { state: desiredState, snapshot: finalSnapshot }
        }

        if (finalSnapshot?.sessionState === 'spec') {
            return { state: 'spec', snapshot: finalSnapshot }
        }

        if (finalSnapshot?.sessionState) {
            return { state: finalSnapshot.sessionState, snapshot: finalSnapshot }
        }

        return { state: 'running', snapshot: finalSnapshot }
    }, [])

    // Ensure terminals exist for a selection
    const ensureTerminals = useCallback(async (sel: Selection): Promise<TerminalSet> => {
        const ids = getTerminalIds(sel)

        if (sel.kind === 'orchestrator') {
            setIsSpecState(false)
            let cwd = projectPath
            if (!cwd) {
                try {
                    cwd = await invoke<string>(TauriCommands.GetCurrentDirectory)
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to resolve current directory for orchestrator terminals', error)
                    cwd = ''
                }
            }

            await createTerminal(ids.top, cwd)
            await registerTerminalsForSelection([ids.top], sel)
            return ids
        }

        const sessionId = sel.payload
        if (!sessionId) {
            setIsSpecState(false)
            return ids
        }

        let snapshot = getCachedSessionSnapshot(sessionId)
        if (!snapshot) {
            snapshot = await ensureSessionSnapshot(sessionId)
        }

        const desiredState = sel.sessionState
        if (snapshot && desiredState && snapshot.sessionState !== desiredState) {
            const refreshed = await ensureSessionSnapshot(sessionId, { refresh: true })
            if (refreshed) {
                snapshot = refreshed
            }
        }

        const { state: resolvedState, snapshot: adjustedSnapshot } = resolveSessionState({
            sessionId,
            desiredState: desiredState ?? null,
            snapshot: snapshot ?? null
        })
        snapshot = adjustedSnapshot

        const isSpecSession = resolvedState === 'spec'
        setIsSpecState(isSpecSession)
        if (isSpecSession) {
            return ids
        }

        if (!snapshot) {
            if (resolvedState === 'running' && sel.worktreePath) {
                const fallbackWorktree = sel.worktreePath
                await createTerminal(ids.top, fallbackWorktree)
                await registerTerminalsForSelection([ids.top], sel)
                return {
                    ...ids,
                    workingDirectory: fallbackWorktree,
                }
            }

            logger.warn('[SelectionContext] Missing session snapshot while ensuring terminals', { sessionId })
            return ids
        }

        const worktreePath = snapshot.worktreePath ?? sel.worktreePath
        if (!worktreePath) {
            logger.error(`[SelectionContext] Session ${sessionId} is running but has no worktree_path`)
            return ids
        }

        try {
            const pathExists = await invoke<boolean>(TauriCommands.PathExists, { path: worktreePath })
            if (!pathExists) {
                logger.warn(`[SelectionContext] Worktree path does not exist for session ${sessionId}: ${worktreePath}`)
                return ids
            }

            const gitDir = `${worktreePath}/.git`
            const hasGit = await invoke<boolean>(TauriCommands.PathExists, { path: gitDir })
            if (!hasGit) {
                logger.warn(`[SelectionContext] Worktree is not properly initialized for session ${sessionId}: ${worktreePath}`)
                return ids
            }
        } catch (error) {
            logger.warn(`[SelectionContext] Could not verify worktree path for session ${sessionId}:`, error)
            return ids
        }

        await createTerminal(ids.top, worktreePath)
        await registerTerminalsForSelection([ids.top], sel)
        try {
            const legacyExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: ids.bottomBase })
            if (legacyExists) {
                await closeTerminalBackend(ids.bottomBase)
                terminalsCreated.current.delete(ids.bottomBase)
            }
        } catch (error) {
            logger.warn(`[SelectionContext] Failed to cleanup legacy bottom terminal for ${sessionId}:`, error)
        }

        return {
            ...ids,
            workingDirectory: worktreePath
        }
    }, [getTerminalIds, projectPath, createTerminal, registerTerminalsForSelection, getCachedSessionSnapshot, ensureSessionSnapshot, resolveSessionState])

    // Helper to get default selection for current project
    const getDefaultSelection = useCallback(async (): Promise<Selection> => {
        if (projectPath) {
            const remembered = lastSelectionByProjectRef.current.get(projectPath)
            if (remembered) {
                logger.info('[SelectionContext] Restored in-memory selection for project:', projectPath, remembered)
                return { ...remembered }
            }
        }

        // Default to orchestrator if no remembered selection
        return { kind: 'orchestrator' }
    }, [projectPath])
    
    // Validate and restore a remembered selection
    const validateAndRestoreSelection = useCallback(async (remembered: Selection): Promise<Selection> => {
        // If orchestrator, it's always valid
        if (remembered.kind === 'orchestrator') {
            return remembered
        }

        // For sessions, check if it still exists and worktree is valid
        if (remembered.kind === 'session' && remembered.payload) {
            try {
                const snapshot = await ensureSessionSnapshot(remembered.payload)
                if (!snapshot) {
                    logger.info(`[SelectionContext] Session ${remembered.payload} could not be resolved, falling back to orchestrator`)
                    return { kind: 'orchestrator' }
                }
                const worktreePath = snapshot.worktreePath || remembered.worktreePath

                // Check if worktree directory still exists
                if (worktreePath) {
                    try {
                        const exists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: worktreePath })
                        if (!exists) {
                            logger.info(`[SelectionContext] Worktree directory ${worktreePath} no longer exists for session ${remembered.payload}, falling back to orchestrator`)
                            return { kind: 'orchestrator' }
                        }
                    } catch (error) {
                        logger.warn(`[SelectionContext] Failed to check worktree directory ${worktreePath}:`, error)
                        // If we can't check, assume it's invalid to be safe
                        return { kind: 'orchestrator' }
                    }
                }

                // Session and worktree are valid
                return {
                    kind: 'session',
                    payload: remembered.payload,
                    worktreePath,
                    sessionState: snapshot.sessionState
                }
            } catch (error) {
                logger.info(`[SelectionContext] Session ${remembered.payload} no longer exists, falling back to orchestrator`, error)
                // Session doesn't exist anymore, fallback to orchestrator
                return { kind: 'orchestrator' }
            }
        }

        // Default fallback
        return { kind: 'orchestrator' }
    }, [ensureSessionSnapshot])
    
    // Clear terminal tracking and close terminals to prevent orphaned processes
    // Used when: 1) Switching projects (orchestrator IDs change), 2) Restarting orchestrator with new model
    const clearTerminalTracking = useCallback(async (terminalIds: string[]) => {
        for (const id of terminalIds) {
            terminalsCreated.current.delete(id)
            creationLock.current.delete(id)
            // Close the actual terminal process to avoid orphaned processes
            try {
                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id })
                if (exists) {
                    await closeTerminalBackend(id)
                }
            } catch (_e) {
                logger.warn(`[SelectionContext] Failed to close terminal ${id}:`, _e)
            }
        }
    }, [])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection, forceRecreate = false, isIntentional = true) => {
        logger.info('[SelectionContext] setSelection invoked', { newSelection, forceRecreate, isIntentional })

        const callToken = ++selectionTokenRef.current
        if (isIntentional) {
            lastIntentionalRef.current++
            suppressAutoRestoreRef.current = true
        }

        document.body.classList.add('session-switching')
        const isAuto = isRestoringRef.current === true
        lastTokenWasAutoRef.current = isAuto
        if (!isAuto) {
            lastUserSelectionEpochRef.current = projectEpochRef.current
            lastUserTokenRef.current = callToken
            userSelectionInFlightRef.current = true
        }

        const newTerminalIds = getTerminalIds(newSelection)
        const targetLabel = newSelection.kind === 'session' ? `session:${newSelection.payload ?? ''}` : 'orchestrator'
        logger.info(`[SelectionContext] Switching to ${targetLabel} (top=${newTerminalIds.top}) at ${new Date().toISOString()}`)

        const isStateTransition = selection.kind === 'session' &&
            newSelection.kind === 'session' &&
            selection.payload === newSelection.payload &&
            isSpec !== (newSelection.sessionState === 'spec')

        const selectionUnchanged = !forceRecreate && !isStateTransition && isReady &&
            selection.kind === newSelection.kind &&
            selection.payload === newSelection.payload &&
            terminals.top === newTerminalIds.top &&
            !(newSelection.kind === 'session' && newSelection.sessionState === undefined)

        if (selectionUnchanged) {
            document.body.classList.remove('session-switching')
            return
        }

        const terminalAlreadyExists = terminalsCreated.current.has(newTerminalIds.top)
        logger.info('[SelectionContext] Terminal existence for quick switch', { id: newTerminalIds.top, terminalAlreadyExists })

        if (!terminalAlreadyExists) {
            setIsReady(false)
            try {
                if (newSelection.kind === 'session') {
                    let resolvedState = newSelection.sessionState
                    let resolvedWorktree = newSelection.worktreePath
                    let snapshot = getCachedSessionSnapshot(newSelection.payload)
                    const shouldForceRefresh = selection.kind === 'session' && selection.payload === newSelection.payload && newSelection.sessionState === undefined

                    if (!snapshot || shouldForceRefresh) {
                        try {
                            snapshot = await ensureSessionSnapshot(newSelection.payload, { refresh: shouldForceRefresh })
                        } catch (error) {
                            logger.warn('[SelectionContext] Failed to resolve session state for optimistic switch:', error)
                        }
                    }

                    if (snapshot) {
                        resolvedState = resolvedState ?? snapshot.sessionState
                        resolvedWorktree = resolvedWorktree ?? snapshot.worktreePath
                    }

                    const { state: finalState, snapshot: adjustedSnapshot } = resolveSessionState({
                        sessionId: newSelection.payload,
                        desiredState: resolvedState ?? null,
                        snapshot: snapshot ?? null
                    })

                    const finalWorktree = finalState === 'spec'
                        ? undefined
                        : (resolvedWorktree ?? adjustedSnapshot?.worktreePath)

                    setIsSpecState(finalState === 'spec')
                    const optimistic = { ...newSelection, sessionState: finalState, worktreePath: finalWorktree }
                    setSelectionState(optimistic)
                    setTerminals(newTerminalIds)
                    setCurrentSelection(optimistic.payload || null)
                } else {
                    setIsSpecState(false)
                    setSelectionState(newSelection)
                    setTerminals(newTerminalIds)
                    setCurrentSelection(null)
                }
            } catch (error) {
                logger.debug('[SelectionContext] Optimistic selection application failed silently:', error)
            }
        }

        const shouldSwitchSessions = forceRecreate || selection.kind !== newSelection.kind || selection.payload !== newSelection.payload
        let previousSuspended = false
        let resumedNew = false

        const suspendIfNeeded = async () => {
            if (shouldSwitchSessions && !previousSuspended) {
                try {
                    await suspendTerminalsForSelection(selection)
                    previousSuspended = true
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to suspend previous session terminals', error)
                }
            }
        }

        const resumeIfNeeded = async () => {
            if (shouldSwitchSessions && !resumedNew) {
                try {
                    await resumeTerminalsForSelection(newSelection)
                    resumedNew = true
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to resume new session terminals', error)
                }
            }
        }

        try {
            if (forceRecreate) {
                const ids = getTerminalIds(newSelection)
                await clearTerminalTracking([ids.top])
            }

            if (terminalAlreadyExists && !forceRecreate) {
                const lastUserToken = lastUserTokenRef.current ?? 0
                if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                    return
                }

                if (newSelection.kind === 'session') {
                    let resolvedState = newSelection.sessionState
                    let resolvedWorktree = newSelection.worktreePath
                    let snapshot = getCachedSessionSnapshot(newSelection.payload)
                    const shouldForceRefresh = selection.kind === 'session' && selection.payload === newSelection.payload && newSelection.sessionState === undefined

                    if (!snapshot || shouldForceRefresh) {
                        try {
                            snapshot = await ensureSessionSnapshot(newSelection.payload, { refresh: shouldForceRefresh })
                        } catch (error) {
                            logger.warn('[SelectionContext] Failed to resolve session state during immediate switch:', error)
                        }
                    }

                    if (snapshot) {
                        resolvedState = resolvedState ?? snapshot.sessionState
                        resolvedWorktree = resolvedWorktree ?? snapshot.worktreePath
                    }

                    const { state: finalState, snapshot: adjustedSnapshot } = resolveSessionState({
                        sessionId: newSelection.payload,
                        desiredState: resolvedState ?? null,
                        snapshot: snapshot ?? null
                    })

                    const finalWorktree = finalState === 'spec'
                        ? undefined
                        : (resolvedWorktree ?? adjustedSnapshot?.worktreePath)

                    setIsSpecState(finalState === 'spec')
                    newSelection = { ...newSelection, sessionState: finalState, worktreePath: finalWorktree }
                } else {
                    setIsSpecState(false)
                }

                await suspendIfNeeded()

                if (callToken === selectionTokenRef.current) {
                    setSelectionState(newSelection)
                    setTerminals(newTerminalIds)
                }

                setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
                if (!isReady) {
                    setIsReady(true)
                }
                if (!isAuto) {
                    rememberSelection(newSelection)
                }

                await resumeIfNeeded()
                return
            }

           const terminalIds = await ensureTerminals(newSelection)
           if (callToken !== selectionTokenRef.current) {
                const lastWasAuto = lastTokenWasAutoRef.current ?? false
                if (!(!isAuto && lastWasAuto)) {
                    return
                }
            }

            const lastUserToken = lastUserTokenRef.current ?? 0
            if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                return
            }

            await suspendIfNeeded()

            if (newSelection.kind === 'session') {
                const currentSnapshot = getCachedSessionSnapshot(newSelection.payload)
                const { state: finalState, snapshot: adjustedSnapshot } = resolveSessionState({
                    sessionId: newSelection.payload,
                    desiredState: newSelection.sessionState ?? null,
                    snapshot: currentSnapshot ?? null
                })
                const finalWorktree = finalState === 'spec'
                    ? undefined
                    : (newSelection.worktreePath ?? adjustedSnapshot?.worktreePath)
                setIsSpecState(finalState === 'spec')
                newSelection = { ...newSelection, sessionState: finalState, worktreePath: finalWorktree }
            } else {
                setIsSpecState(false)
            }

            setSelectionState(newSelection)
            setTerminals(terminalIds)
            setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)

            if (!isAuto) {
                rememberSelection(newSelection)
            }

            setIsReady(true)

            await resumeIfNeeded()
        } catch (error) {
            logger.error('[SelectionContext] Failed to set selection:', error)
            setIsReady(true)
            if (previousSuspended && !resumedNew) {
                try {
                    await resumeTerminalsForSelection(selection)
                } catch (resumeError) {
                    logger.warn('[SelectionContext] Failed to re-resume previous session after error', resumeError)
                }
            }
        } finally {
            finalizeSelectionChange(newSelection)
            if (isIntentional) {
                suppressAutoRestoreRef.current = false
            }
            if (!isAuto) {
                userSelectionInFlightRef.current = false
            }
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, isSpec, setCurrentSelection, finalizeSelectionChange, suspendTerminalsForSelection, resumeTerminalsForSelection, getCachedSessionSnapshot, ensureSessionSnapshot, rememberSelection, resolveSessionState])

    // Start a lightweight backend watcher for the currently selected running session
    useEffect(() => {
        const startOrSwitchWatcher = async () => {
            try {
                if (selection.kind === 'session' && selection.payload && !isSpec) {
                    if (orchestratorWatcherActiveRef.current) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: ORCHESTRATOR_SESSION_ID }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop project watcher before switching to session', e) }
                        orchestratorWatcherActiveRef.current = false
                    }

                    const current = selection.payload
                    const prev = lastWatchedSessionRef.current
                    if (prev && prev !== current) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: prev }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop previous file watcher', e) }
                    }
                    await invoke(TauriCommands.StartFileWatcher, { sessionName: current })
                    lastWatchedSessionRef.current = current
                } else {
                    const prev = lastWatchedSessionRef.current
                    if (prev) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: prev }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop file watcher on deselect', e) }
                    }
                    lastWatchedSessionRef.current = null

                    if (selection.kind === 'orchestrator') {
                        if (!orchestratorWatcherActiveRef.current) {
                            try {
                                await invoke(TauriCommands.StartFileWatcher, { sessionName: ORCHESTRATOR_SESSION_ID })
                                orchestratorWatcherActiveRef.current = true
                            } catch (e) {
                                logger.warn('[SelectionContext] Failed to start project watcher', e)
                            }
                        }
                    } else if (orchestratorWatcherActiveRef.current) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: ORCHESTRATOR_SESSION_ID }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop project watcher', e) }
                        orchestratorWatcherActiveRef.current = false
                    }
                }
            } catch (e) {
                logger.warn('[SelectionContext] File watcher setup failed; session indicators may update slower:', e)
            }
        }
        startOrSwitchWatcher()
        // Stop watcher on unmount
        return () => {
            const prev = lastWatchedSessionRef.current
            if (prev) {
                try {
                    const stopResult = invoke(TauriCommands.StopFileWatcher, { sessionName: prev })
                    Promise.resolve(stopResult).catch((e) => {
                        logger.warn('[SelectionContext] Failed to stop watcher on unmount', e)
                    })
                } catch (e) {
                    logger.warn('[SelectionContext] Failed to stop watcher on unmount', e)
                }
            }
            if (orchestratorWatcherActiveRef.current) {
                try {
                    const stopResult = invoke(TauriCommands.StopFileWatcher, { sessionName: ORCHESTRATOR_SESSION_ID })
                    Promise.resolve(stopResult).catch((e) => {
                        logger.warn('[SelectionContext] Failed to stop project watcher on unmount', e)
                    })
                } catch (e) {
                    logger.warn('[SelectionContext] Failed to stop project watcher on unmount', e)
                }
            }
            orchestratorWatcherActiveRef.current = false
            lastWatchedSessionRef.current = null
        }
    }, [selection, isSpec])

    // React to backend session refreshes (e.g., spec -> running)
    useEffect(() => {
        let disposed = false
        let cleanup: (() => void) | null = null

        const attach = async () => {
            try {
                const unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async (updatedSessions) => {
                    if (selection.kind !== 'session' || !selection.payload) return

                    const processingToken = selectionTokenRef.current

                    try {
                        let snapshot: SessionSnapshot | null = null
                        if (Array.isArray(updatedSessions)) {
                            const refreshed = updatedSessions.find((s) => s.info.session_id === selection.payload)
                            if (refreshed) {
                                snapshot = snapshotFromEnrichedSession(refreshed)
                                sessionSnapshotsRef.current.set(selection.payload, snapshot)
                            }
                        }
                        if (!snapshot) {
                            snapshot = await ensureSessionSnapshot(selection.payload, { refresh: false })
                        }

                        if (processingToken !== selectionTokenRef.current) {
                            return
                        }

                        const state = snapshot?.sessionState
                        const worktreePath = snapshot?.worktreePath
                        const nowSpec = state === 'spec'
                        const wasSpec = isSpec

                        setIsSpecState(!!nowSpec)

                        if (wasSpec && !nowSpec) {
                            const updatedSelection = {
                                ...selection,
                                sessionState: state,
                                worktreePath: worktreePath || selection.worktreePath
                            }
                            setSelectionState(updatedSelection)

                            try {
                                const ids = await ensureTerminals(updatedSelection)
                                if (processingToken === selectionTokenRef.current) {
                                    setTerminals(ids)
                                }
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to create terminals for newly running session', _e)
                            }
                        }

                        if (!wasSpec && nowSpec) {
                            if (worktreePath) {
                                logger.info(`[SelectionContext] Session ${selection.payload} marked reviewed, preserving terminals`)
                                return
                            }

                            logger.info(`[SelectionContext] Session ${selection.payload} converting to spec, closing terminals`)
                            const updatedSelection = {
                                ...selection,
                                sessionState: 'spec' as const,
                                worktreePath: undefined
                            }
                            const updatedTerminals = getTerminalIds(updatedSelection)
                            setSelectionState(updatedSelection)
                            setTerminals(updatedTerminals)
                            setCurrentSelection(updatedSelection.payload ?? null)

                            try {
                                await clearTerminalTracking([updatedTerminals.top])
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to cleanup terminals after running→spec transition:', _e)
                            }
                            return
                        }

                        if (!wasSpec && !nowSpec && state !== selection.sessionState) {
                            const updatedSelection = {
                                ...selection,
                                sessionState: state,
                                worktreePath: worktreePath || selection.worktreePath
                            }
                            if (processingToken === selectionTokenRef.current) {
                                setSelectionState(updatedSelection)
                            }
                        }
                    } catch (_e) {
                        logger.warn('[SelectionContext] Failed to refresh current session state after event', _e)
                    }
                })

                if (disposed) {
                    unlisten()
                } else {
                    cleanup = unlisten
                }
            } catch (_e) {
                logger.warn('[SelectionContext] Failed to attach sessions-refreshed listener', _e)
            }
        }

        attach()

        return () => {
            disposed = true
            if (cleanup) {
                try {
                    cleanup()
                } catch (e) {
                    logger.debug('[SelectionContext] Failed to cleanup sessions-refreshed listener', e)
                }
            }
        }
    }, [selection, ensureTerminals, getTerminalIds, isSpec, ensureSessionSnapshot, setTerminals, setCurrentSelection, clearTerminalTracking])
    
    // Initialize on mount and when project path changes
    useEffect(() => {
        const initialize = async () => {
            logger.info('[SelectionContext] Initialize effect triggered, projectPath:', projectPath)
            
            // Wait for projectPath to be set before initializing
            if (!projectPath) {
                logger.info('[SelectionContext] No projectPath, skipping initialization')
                setIsReady(true)
                return
            }
            
            // Skip if already initialized with same project path
            if (hasInitialized.current && previousProjectPath.current === projectPath) {
                logger.info('[SelectionContext] Already initialized with same project path, skipping')
                return
            }
            
            // Check if we're switching projects
            const projectChanged = hasInitialized.current && 
                                  previousProjectPath.current !== null && 
                                  previousProjectPath.current !== projectPath
            
            logger.info('[SelectionContext] Project changed?', projectChanged, 'Previous:', previousProjectPath.current, 'New:', projectPath)
            
            // Set initialized flag and update previous path
            hasInitialized.current = true
            // Bump the project epoch on project change
            if (previousProjectPath.current !== projectPath) {
                projectEpochRef.current += 1
            }

            previousProjectPath.current = projectPath

            // Check if terminal IDs have changed before doing expensive operations
            const currentIds = getTerminalIds({ kind: 'orchestrator' })
            const idsChanged = !terminals.top || terminals.top !== currentIds.top

            if (idsChanged) {
                // Ensure orchestrator terminals use project-specific IDs on init
                // Signal readiness only after the top terminal reports ready to avoid race in tests
                try {
                    if (selection.kind === 'orchestrator') {
                        setTerminals(currentIds)
                        await ensureTerminals({ kind: 'orchestrator' })

                        const expectedTopId = currentIds.top
                        const onReady = (ev: Event) => {
                            const detail = (ev as CustomEvent<{ terminalId: string }>).detail
                            if (detail?.terminalId === expectedTopId) {
                                setIsReady(true)
                                window.removeEventListener('schaltwerk:terminal-ready', onReady as EventListener)
                            }
                        }
                        window.addEventListener('schaltwerk:terminal-ready', onReady as EventListener)

                        // Also handle the case where terminal mounted before listener attached
                        // by synchronously marking ready when IDs are project-scoped and terminal already exists
                        try {
                            const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: expectedTopId })
                            if (exists) {
                                setIsReady(true)
                                window.removeEventListener('schaltwerk:terminal-ready', onReady as EventListener)
                            }
                        } catch (err) {
                            logger.warn('[SelectionContext] Terminal existence check failed during init:', err)
                        }
                    } else {
                        // Non-orchestrator initialization path
                        setIsReady(true)
                    }
                } catch (e) {
                    logger.warn('[SelectionContext] Failed to initialize orchestrator terminals:', e)
                    setIsReady(true)
                }
            } else {
                // Terminal IDs haven't changed, just mark as ready
                setIsReady(true)
            }
            return
        }
        
        // Only run if not currently initializing
        initialize().catch(_e => {
            logger.error('[SelectionContext] Failed to initialize:', _e)
            // Still mark as ready even on error so UI doesn't hang
            setIsReady(true)
        })
    }, [projectPath, setSelection, getTerminalIds, validateAndRestoreSelection, getDefaultSelection, selection, ensureTerminals, terminals.top]) // Re-run when projectPath changes
    
    // Listen for selection events from backend (e.g., when MCP creates/updates specs)
    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | undefined
        
        const setupSelectionListener = async () => {
            try {
                const stop = await listenEvent(SchaltEvent.Selection, async (target) => {
                    logger.info('Received selection event from backend:', target)

                    // Guard: Don't auto-switch to a spec when user is focused on a running session
                    // and the sidebar filter is set to Running. This avoids jumping away from terminals
                    // when a new spec is created by MCP/background.
                    if (target?.kind === 'session') {
                        let resolvedSnapshot: SessionSnapshot | null = null
                        let targetIsSpec = target.sessionState === 'spec'

                        // If the event didn't include sessionState, resolve it
                        if (target.sessionState === undefined) {
                            resolvedSnapshot = getCachedSessionSnapshot(target.payload)
                            if (!resolvedSnapshot) {
                                try {
                                    resolvedSnapshot = await ensureSessionSnapshot(target.payload)
                                } catch (_e) {
                                    logger.warn('[SelectionContext] Failed to resolve session state for backend selection event:', _e)
                                }
                            }
                            targetIsSpec = resolvedSnapshot?.sessionState === 'spec'
                        }

                        // If currently on a running session and filter hides specs, ignore spec selection
                        if (
                            targetIsSpec &&
                            selection.kind === 'session' &&
                            !isSpec &&
                            filterMode === FilterMode.Running
                        ) {
                            logger.info('[SelectionContext] Ignoring backend spec selection to preserve running session focus under Running filter')
                            return
                        }
                    }

                    // If any modal is open, defer selection until after modals close
                    if (isAnyModalOpen()) {
                        logger.info('[SelectionContext] Modal open; deferring backend selection until modals close')
                        pendingSelectionRef.current = target
                        return
                    }
                    // Augment target with resolved state/worktree for determinism
                    if (target?.kind === 'session' && target.payload && target.sessionState === undefined) {
                        let snapshot = getCachedSessionSnapshot(target.payload)
                        if (!snapshot) {
                            try {
                                snapshot = await ensureSessionSnapshot(target.payload)
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to resolve state for backend selection event:', _e)
                            }
                        }
                        if (snapshot) {
                            target = {
                                ...target,
                                sessionState: snapshot.sessionState,
                                worktreePath: snapshot.worktreePath || target.worktreePath
                            }
                        }
                    }
                    // Set the selection to the requested session/spec - this is intentional (backend requested)
                    await setSelection(target, false, true)
                })
                if (disposed) {
                    stop()
                } else {
                    unlisten = stop
                }
            } catch (_e) {
                logger.error('[SelectionContext] Failed to attach selection listener', _e)
            }
        }
        
        setupSelectionListener()
        
        return () => {
            disposed = true
            if (unlisten) {
                unlisten()
            }
        }
    }, [setSelection, selection, isSpec, filterMode, isAnyModalOpen, getCachedSessionSnapshot, ensureSessionSnapshot])

    // When modals close, apply any deferred selection
    useEffect(() => {
        if (openModals.size === 0 && pendingSelectionRef.current) {
            const pending = pendingSelectionRef.current
            pendingSelectionRef.current = null
            logger.info('[SelectionContext] Applying deferred backend selection now that modals are closed:', pending)
            setSelection(pending, false, true).catch(_e => logger.error('Failed to apply deferred selection:', _e))
        }
    }, [openModals, setSelection])

    useEffect(() => {
        const cleanup = listenUiEvent(UiEvent.OpenSpecInOrchestrator, async (detail) => {
            if (!detail?.sessionName) return
            logger.info('[SelectionContext] Received OpenSpecInOrchestrator event, switching to orchestrator')
            await setSelection({ kind: 'orchestrator' }, false, true)
        })
        return cleanup
    }, [setSelection])

    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            clearTerminalTracking,
            isReady,
            isSpec
        }}>
            {children}
        </SelectionContext.Provider>
    )
}

export function useSelection() {
    const context = useContext(SelectionContext)
    return context
}
