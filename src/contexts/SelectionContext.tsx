import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'
import { useProject } from './ProjectContext'
import { useFontSize } from './FontSizeContext'
import { useSessions } from './SessionsContext'
import { FilterMode } from '../types/sessionFilters'
import { RawSession, ProjectSelection, EnrichedSession } from '../types/session'
import { logger } from '../utils/logger'
import { useModal } from './ModalContext'
import { UiEvent, emitUiEvent } from '../common/uiEvents'

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
    const [isSpec, setIsSpec] = useState(false)
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
    // Track active file watcher session to switch watchers on selection change
    const lastWatchedSessionRef = useRef<string | null>(null)
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
    const sessionFetchPromisesRef = useRef(new Map<string, Promise<SessionSnapshot | null>>())

    // Helper: finalize a selection change by removing the switching class and notifying listeners
    const finalizeSelectionChange = useCallback((sel: Selection) => {
        const doFinalize = () => {
            document.body.classList.remove('session-switching')
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
                const sanitize = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
                if (sel.kind === 'session' && sel.payload) {
                    emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sanitize(sel.payload) })
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
    }, [])
    
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
            // Sanitize session name: replace spaces and special chars with underscores
            const sanitizedSessionName = (sel.payload || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
            const base = `session-${sanitizedSessionName}`
            const sessionWorkingDir = sel.sessionState === 'running' && sel.worktreePath ? sel.worktreePath : ''
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
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
                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id })
                if (!exists) {
                    await invoke(TauriCommands.CreateTerminal, { id, cwd })
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

    // Ensure terminals exist for a selection
    const ensureTerminals = useCallback(async (sel: Selection): Promise<TerminalSet> => {
        const ids = getTerminalIds(sel)

        // Orchestrator always has terminals and is never a spec
        if (sel.kind === 'orchestrator') {
            setIsSpec(false)
            const cwd = projectPath || await invoke<string>(TauriCommands.GetCurrentDirectory)
            const primaryBottomId = `${ids.bottomBase}-0`
            const terminalsToRegister: string[] = []

            await createTerminal(ids.top, cwd)
            terminalsToRegister.push(ids.top)

            try {
                await createTerminal(primaryBottomId, cwd)
                terminalsToRegister.push(primaryBottomId)
            } catch (error) {
                logger.warn('[SelectionContext] Failed to pre-create orchestrator bottom terminal', error)
            }

            if (terminalsToRegister.length > 0) {
                await registerTerminalsForSelection(terminalsToRegister, sel)
            }

            return {
                ...ids,
                workingDirectory: cwd,
            }
        }

        const sessionId = sel.payload
        if (!sessionId) {
            setIsSpec(false)
            return ids
        }

        let snapshot = getCachedSessionSnapshot(sessionId)
        if (!snapshot) {
            snapshot = await ensureSessionSnapshot(sessionId)
        }

        if (!snapshot) {
            logger.warn('[SelectionContext] Missing session snapshot while ensuring terminals', { sessionId })
            setIsSpec(false)
            return ids
        }

        const isSpecSession = snapshot.sessionState === 'spec'
        setIsSpec(isSpecSession)

        if (isSpecSession) {
            return ids
        }

        const worktreePath = snapshot.worktreePath
        if (!worktreePath) {
            logger.error(`[SelectionContext] Session ${sessionId} is running but has no worktree_path`)
            return ids
        }

        try {
            const exists = await invoke<boolean>(TauriCommands.PathExists, { path: worktreePath })
            if (!exists) {
                logger.warn(`[SelectionContext] Worktree path does not exist for session ${sessionId}: ${worktreePath}`)
                return ids
            }

            const gitDir = `${worktreePath}/.git`
            const hasGit = await invoke<boolean>(TauriCommands.PathExists, { path: gitDir })
            if (!hasGit) {
                logger.warn(`[SelectionContext] Worktree is not properly initialized for session ${sessionId}: ${worktreePath}`)
                return ids
            }
        } catch (_e) {
            logger.warn(`[SelectionContext] Could not verify worktree path for session ${sessionId}:`, _e)
            return ids
        }

        const primaryBottomId = `${ids.bottomBase}-0`
        const terminalsToRegister: string[] = []

        await createTerminal(ids.top, worktreePath)
        terminalsToRegister.push(ids.top)

        try {
            await createTerminal(primaryBottomId, worktreePath)
            terminalsToRegister.push(primaryBottomId)
        } catch (error) {
            logger.warn(`[SelectionContext] Failed to pre-create bottom terminal for session ${sessionId}:`, error)
        }

        if (terminalsToRegister.length > 0) {
            await registerTerminalsForSelection(terminalsToRegister, sel)
        }
        try {
            const legacyExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: ids.bottomBase })
            if (legacyExists) {
                await invoke(TauriCommands.CloseTerminal, { id: ids.bottomBase })
                terminalsCreated.current.delete(ids.bottomBase)
            }
        } catch (_e) {
            logger.warn(`[SelectionContext] Failed to cleanup legacy bottom terminal for ${sessionId}:`, _e)
        }

        return {
            ...ids,
            workingDirectory: worktreePath
        }
    }, [getTerminalIds, projectPath, createTerminal, registerTerminalsForSelection, getCachedSessionSnapshot, ensureSessionSnapshot])
    
    // Helper to get default selection for current project
    const getDefaultSelection = useCallback(async (): Promise<Selection> => {
        // Try to load saved selection for this project from database
        if (projectPath) {
            try {
                const dbSelection = await invoke<ProjectSelection | null>(TauriCommands.GetProjectSelection)
                if (dbSelection) {
                    logger.info('[SelectionContext] Restored saved selection for project:', projectPath, dbSelection)
                    return {
                        kind: dbSelection.kind as 'session' | 'orchestrator',
                        payload: dbSelection.payload ?? undefined
                    }
                }
            } catch (error) {
                logger.error('[SelectionContext] Failed to load saved selection:', error)
            }
        }
        
        // Default to orchestrator if no saved selection
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
                    await invoke(TauriCommands.CloseTerminal, { id })
                }
            } catch (_e) {
                logger.warn(`[SelectionContext] Failed to close terminal ${id}:`, _e)
            }
        }
    }, [])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection, forceRecreate = false, isIntentional = true) => {
        logger.info('[SelectionContext] setSelection invoked', { newSelection, forceRecreate, isIntentional })

        // Increment token to invalidate previous async continuations
        const callToken = ++selectionTokenRef.current
        if (isIntentional) {
            lastIntentionalRef.current++
            suppressAutoRestoreRef.current = true
        }
        // Mark session switching to prevent terminal resize interference
        document.body.classList.add('session-switching')
        // Treat any non-restoration call as a user selection within current project epoch
        const isAuto = isRestoringRef.current === true
        lastTokenWasAutoRef.current = isAuto
        if (!isAuto) {
            lastUserSelectionEpochRef.current = projectEpochRef.current
            // Track most recent user token to prioritize over auto-restores
            lastUserTokenRef.current = callToken
            userSelectionInFlightRef.current = true
        }
        
        // Get the new terminal IDs to check if they're changing
        const newTerminalIds = getTerminalIds(newSelection)
        
        // Check if session state is changing from spec to running (or vice versa)
        const isStateTransition = selection.kind === 'session' && 
            newSelection.kind === 'session' && 
            selection.payload === newSelection.payload &&
            isSpec !== (newSelection.sessionState === 'spec')
        
        // Check if we're actually changing selection or terminals (but allow initial setup, force recreate, or state transitions)
        if (!forceRecreate && !isStateTransition && isReady && 
            selection.kind === newSelection.kind && 
            selection.payload === newSelection.payload &&
            terminals.top === newTerminalIds.top &&
            // If sessionState is unknown for a session, do not early-return; resolve current state
            !(newSelection.kind === 'session' && newSelection.sessionState === undefined)) {
            // Remove session switching class if no actual change
            document.body.classList.remove('session-switching')
            return
        }
        
        // For already created terminals, switch immediately without showing "Initializing..."
        const terminalAlreadyExists = terminalsCreated.current.has(newTerminalIds.top)
        logger.info('[SelectionContext] Terminal existence for quick switch', { id: newTerminalIds.top, terminalAlreadyExists })
        
        // Only mark as not ready if we actually need to create new terminals
        if (!terminalAlreadyExists) {
            setIsReady(false)
            // Optimistically apply selection for better UX and deterministic tests
            try {
                if (newSelection.kind === 'session') {
                    let resolvedState = newSelection.sessionState
                    let resolvedWorktree = newSelection.worktreePath
                    if (!resolvedState || !resolvedWorktree) {
                        const shouldForceRefresh = selection.kind === 'session' && selection.payload === newSelection.payload && newSelection.sessionState === undefined
                        let snapshot = getCachedSessionSnapshot(newSelection.payload)
                        if (!snapshot || shouldForceRefresh) {
                            try {
                                snapshot = await ensureSessionSnapshot(newSelection.payload, { refresh: shouldForceRefresh })
                            } catch (e) {
                                logger.warn('[SelectionContext] Failed to resolve session state for optimistic switch:', e)
                            }
                        }
                        if (snapshot) {
                            resolvedState = resolvedState || snapshot.sessionState
                            resolvedWorktree = resolvedWorktree || snapshot.worktreePath
                        }
                    }
                    setIsSpec(resolvedState === 'spec')
                    const optimistic = { ...newSelection, sessionState: resolvedState, worktreePath: resolvedWorktree }
                    // Apply immediately for user selections to ensure determinism
                    setSelectionState(optimistic)
                    setTerminals(newTerminalIds)
                    setCurrentSelection(optimistic.payload || null)
                    if (!isRestoringRef.current && projectPath) {
                        try {
                            await invoke(TauriCommands.SetProjectSelection, {
                                kind: optimistic.kind,
                                payload: optimistic.payload ?? null
                            })
                        } catch (e) {
                            logger.error('[SelectionContext] Failed to persist optimistic selection to database:', e)
                        }
                    }
                } else {
                    // Orchestrator optimistic set
                    setIsSpec(false)
                    setSelectionState(newSelection)
                    setTerminals(newTerminalIds)
                    setCurrentSelection(null)
                    if (!isRestoringRef.current && projectPath) {
                        try {
                            await invoke(TauriCommands.SetProjectSelection, {
                                kind: newSelection.kind,
                                payload: newSelection.payload ?? null
                            })
                        } catch (e) {
                            logger.error('[SelectionContext] Failed to persist optimistic selection to database:', e)
                        }
                    }
                }
            } catch (e) {
                logger.debug('[SelectionContext] Optimistic selection application failed silently:', e)
            }
        }
        
        const shouldSwitchSessions = forceRecreate || selection.kind !== newSelection.kind || selection.payload !== newSelection.payload
        let previousSuspended = false
        let resumedNew = false

        try {
            // If forcing recreate, clear terminal tracking and close old terminals first
            if (forceRecreate) {
                const ids = getTerminalIds(newSelection)
                await clearTerminalTracking([ids.top])
            }
            
            // If terminal already exists, update state immediately for instant switch
            if (terminalAlreadyExists && !forceRecreate) {
                // If this is an auto-restore and a newer user selection occurred, skip applying
                const lastUserToken = lastUserTokenRef.current ?? 0
                if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                    return
                }
                // Ensure we have authoritative state when sessionState is unknown
                if (newSelection.kind === 'session') {
                    let resolvedState = newSelection.sessionState
                    let resolvedWorktree = newSelection.worktreePath
                    if (!resolvedState) {
                        const shouldForceRefresh = selection.kind === 'session' && selection.payload === newSelection.payload && newSelection.sessionState === undefined
                        let snapshot = getCachedSessionSnapshot(newSelection.payload)
                        if (!snapshot || shouldForceRefresh) {
                            try {
                                snapshot = await ensureSessionSnapshot(newSelection.payload, { refresh: shouldForceRefresh })
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to resolve session state during immediate switch:', _e)
                            }
                        }
                        if (snapshot) {
                            resolvedState = snapshot.sessionState
                            resolvedWorktree = resolvedWorktree || snapshot.worktreePath
                        }
                    }
                    setIsSpec(resolvedState === 'spec')
                    logger.info('[SelectionContext] Immediate switch resolved state', { payload: newSelection.payload, resolvedState, isSpec: resolvedState === 'spec' })
                    // Persist the resolved state back into selection we apply below
                    newSelection = { ...newSelection, sessionState: resolvedState, worktreePath: resolvedWorktree }
                } else {
                    // Orchestrator is never a spec
                    setIsSpec(false)
                }

                if (shouldSwitchSessions && !previousSuspended) {
                    try {
                        await suspendTerminalsForSelection(selection)
                        previousSuspended = true
                    } catch (error) {
                        logger.warn('[SelectionContext] Failed to suspend previous session terminals', error)
                    }
                }

                // Update selection and terminals immediately
                if (callToken === selectionTokenRef.current) {
                    setSelectionState(newSelection)
                    setTerminals(newTerminalIds)
                }
                
                // Notify SessionsContext about the selection change to preserve position during sorting
                setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
                
                // Save to database for any non-restoration change (intentional or local user action)
                if (!isAuto && projectPath) {
                    try {
                        await invoke(TauriCommands.SetProjectSelection, {
                            kind: newSelection.kind,
                            payload: newSelection.payload ?? null
                        })
            } catch (_e) {
                logger.error('[SelectionContext] Failed to persist selection to database:', _e)
            }
                }
                
                // Ensure ready state
                if (!isReady) {
                    setIsReady(true)
                }

                if (shouldSwitchSessions && !resumedNew) {
                    try {
                        await resumeTerminalsForSelection(newSelection)
                        resumedNew = true
                    } catch (error) {
                        logger.warn('[SelectionContext] Failed to resume new session terminals', error)
                    }
                }

                // Finalize immediate switch
                finalizeSelectionChange(newSelection)
                return
            }
            
            // For new terminals, create them first
            const terminalIds = await ensureTerminals(newSelection)
            // If another selection superseded this call, abandon applying its result
            if (callToken !== selectionTokenRef.current) {
                const lastWasAuto = lastTokenWasAutoRef.current ?? false
                // Allow user selection to continue even if an auto selection bumped the token
                if (!( !isAuto && lastWasAuto )) {
                    return
                }
            }
            // If this is an auto-restore and a newer user selection occurred while creating, skip applying
            const lastUserToken = lastUserTokenRef.current ?? 0
            if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                return
            }

            if (shouldSwitchSessions && !previousSuspended) {
                try {
                    await suspendTerminalsForSelection(selection)
                    previousSuspended = true
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to suspend previous session terminals', error)
                }
            }

            // Now atomically update both selection and terminals (may overwrite optimistic values)
            setSelectionState(newSelection)
            setTerminals(terminalIds)
            
            // Notify SessionsContext about the selection change to preserve position during sorting
            setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
            
            // Save to database for any non-restoration change
            if (!isAuto && projectPath) {
                try {
                    await invoke(TauriCommands.SetProjectSelection, {
                        kind: newSelection.kind,
                        payload: newSelection.payload ?? null
                    })
                } catch (_e) {
                    logger.error('[SelectionContext] Failed to persist selection to database:', _e)
                }
            }

            // Mark as ready
            setIsReady(true)

            if (shouldSwitchSessions && !resumedNew) {
                try {
                    await resumeTerminalsForSelection(newSelection)
                    resumedNew = true
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to resume new session terminals', error)
                }
            }

        } catch (_e) {
            logger.error('[SelectionContext] Failed to set selection:', _e)
            // Stay on current selection if we fail
            setIsReady(true)
            // Attempt to roll back suspension if new session wasn't resumed
            if (previousSuspended && !resumedNew) {
                try {
                    await resumeTerminalsForSelection(selection)
                } catch (error) {
                    logger.warn('[SelectionContext] Failed to re-resume previous session after error', error)
                }
            }
        } finally {
            // Always finalize selection changes and clear transient flags
            finalizeSelectionChange(newSelection)
            if (isIntentional) {
                suppressAutoRestoreRef.current = false
            }
            if (!isAuto) userSelectionInFlightRef.current = false
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, projectPath, isSpec, setCurrentSelection, finalizeSelectionChange, suspendTerminalsForSelection, resumeTerminalsForSelection, getCachedSessionSnapshot, ensureSessionSnapshot])

    // Start a lightweight backend watcher for the currently selected running session
    useEffect(() => {
        const startOrSwitchWatcher = async () => {
            try {
                if (selection.kind === 'session' && selection.payload && !isSpec) {
                    const current = selection.payload
                    // Stop previous watcher if switched sessions
                    const prev = lastWatchedSessionRef.current
                    if (prev && prev !== current) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: prev }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop previous file watcher', e) }
                    }
                    await invoke(TauriCommands.StartFileWatcher, { sessionName: current })
                    lastWatchedSessionRef.current = current
                } else {
                    // Not a running session → stop previous watcher if any
                    const prev = lastWatchedSessionRef.current
                    if (prev) {
                        try { await invoke(TauriCommands.StopFileWatcher, { sessionName: prev }) }
                        catch (e) { logger.warn('[SelectionContext] Failed to stop file watcher on deselect', e) }
                    }
                    lastWatchedSessionRef.current = null
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
            lastWatchedSessionRef.current = null
        }
    }, [selection, isSpec])

    // React to backend session refreshes (e.g., spec -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async (updatedSessions) => {
                    if (selection.kind !== 'session' || !selection.payload) return
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
                        const state = snapshot?.sessionState
                        const worktreePath = snapshot?.worktreePath
                        const nowSpec = state === 'spec'
                        const wasSpec = isSpec

                        // Update isSpec state
                        setIsSpec(!!nowSpec)

                        // If state changed from spec to running, update selection and ensure terminals
                        if (wasSpec && !nowSpec) {
                            // Session became running - update the selection's sessionState
                            const updatedSelection = {
                                ...selection,
                                sessionState: state,
                                worktreePath: worktreePath || selection.worktreePath
                            }
                            setSelectionState(updatedSelection)
                            
                            // Ensure terminals exist now that it's running
                            try { 
                                const ids = await ensureTerminals(updatedSelection)
                                setTerminals(ids)
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to create terminals for newly running session', _e)
                            }
                        }

                        // If state changed from running to spec, ensure terminal UI is not shown and clear tracking
                        if (!wasSpec && nowSpec) {
                            const updatedSelection = {
                                ...selection,
                                sessionState: 'spec' as const,
                                worktreePath: undefined
                            }
                            setSelectionState(updatedSelection)
                            // Clear created flags for this session's terminals and close if present
                            const ids = getTerminalIds(updatedSelection)
                            try {
                                terminalsCreated.current.delete(ids.top)
                                creationLock.current.delete(ids.top)
                                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: ids.top })
                                if (exists) {
                                    await invoke(TauriCommands.CloseTerminal, { id: ids.top })
                                }
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to cleanup terminals after running→spec transition:', _e)
                            }
                        }
                    } catch (_e) {
                        logger.warn('[SelectionContext] Failed to refresh current session state after event', _e)
                    }
                })
            } catch (_e) {
                logger.warn('[SelectionContext] Failed to attach sessions-refreshed listener', _e)
            }
        }
        attach()
        return () => { try { if (unlisten) unlisten() } catch {
            // Cleanup failed, ignore
        } }
    }, [selection, ensureTerminals, getTerminalIds, isSpec, ensureSessionSnapshot])
    
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
        let unlisten: (() => void) | undefined
        
        const setupSelectionListener = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.Selection, async (target) => {
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
            } catch (_e) {
                logger.error('[SelectionContext] Failed to attach selection listener', _e)
            }
        }
        
        setupSelectionListener()
        
        return () => {
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
