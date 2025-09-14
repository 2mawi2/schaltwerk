import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'
import { useProject } from './ProjectContext'
import { useFontSize } from './FontSizeContext'
import { useSessions } from './SessionsContext'
import { FilterMode } from '../types/sessionFilters'
import { RawSession, ProjectSelection } from '../types/session'
import { logger } from '../utils/logger'
import { useModal } from './ModalContext'

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
    const { setCurrentSelection, filterMode } = useSessions()
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
    const { isAnyModalOpen, openModals } = useModal()
    const pendingSelectionRef = useRef<Selection | null>(null)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())
    
    const isRestoringRef = useRef(false)
    // Monotonic token to ignore out-of-order async completions
    const selectionTokenRef = useRef(0)
    // Tracks user-intent selections to avoid auto-restore overriding explicit user actions
    const lastIntentionalRef = useRef(0)
    const suppressAutoRestoreRef = useRef(false)

    // Helper: finalize a selection change by removing the switching class and notifying listeners
    const finalizeSelectionChange = useCallback((sel: Selection) => {
        const doFinalize = () => {
            document.body.classList.remove('session-switching')
            try {
                const detail = sel.kind === 'session'
                    ? { kind: 'session', sessionId: sel.payload }
                    : { kind: 'orchestrator' as const }
                window.dispatchEvent(new CustomEvent('schaltwerk:opencode-selection-resize', { detail }))
            } catch (e) {
                logger.warn('[SelectionContext] Failed to dispatch selection resize event', e)
            }
        }
        const isTestEnv = typeof process !== 'undefined' && (process as unknown as { env?: Record<string, string> }).env?.NODE_ENV === 'test'
        if (isTestEnv) doFinalize()
        else requestAnimationFrame(doFinalize)
    }, [])
    
    // Get terminal IDs for a selection
    const getTerminalIds = useCallback((sel: Selection): TerminalSet => {
        let workingDir = projectPath || ''
        
        if (sel.kind === 'orchestrator') {
            // Make orchestrator terminals project-specific by using project path hash
            // Use a simple hash of the full path to ensure uniqueness
            let projectId = 'default'
            if (projectPath) {
                // Get just the last directory name and combine with a hash for uniqueness
                const dirName = projectPath.split(/[/\\]/).pop() || 'unknown'
                // Sanitize directory name: replace spaces and special chars with underscores
                const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
                // Simple hash: sum of char codes
                let hash = 0
                for (let i = 0; i < projectPath.length; i++) {
                    hash = ((hash << 5) - hash) + projectPath.charCodeAt(i)
                    hash = hash & hash // Convert to 32bit integer
                }
                projectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
            }
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
            const sessionWorkingDir = sel.worktreePath || workingDir
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: sessionWorkingDir
            }
        }
    }, [projectPath])
    
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
            await createTerminal(ids.top, cwd)
            return ids
        }

        // Always fetch session data to ensure we have the correct worktree path
        try {
            const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sel.payload })
            const state: string | undefined = sessionData?.session_state
            const worktreePath: string | undefined = sessionData?.worktree_path
            const isSpecSession = state === 'spec'
            setIsSpec(!!isSpecSession)

            if (isSpecSession) {
                // Do not create terminals for specs
                return ids
            }

            // For running sessions, worktree_path must exist
            if (!worktreePath) {
                logger.error(`[SelectionContext] Session ${sel.payload} is not a spec but has no worktree_path`)
                // Don't create terminals with incorrect working directory
                return ids
            }

            // Verify worktree directory exists and is valid before creating terminals
            try {
                const exists = await invoke<boolean>(TauriCommands.PathExists, { path: worktreePath })
                if (!exists) {
                    logger.warn(`[SelectionContext] Worktree path does not exist for session ${sel.payload}: ${worktreePath}`)
                    return ids
                }
                
                // Additional check: ensure it's a valid git worktree
                const gitDir = `${worktreePath}/.git`
                const hasGit = await invoke<boolean>(TauriCommands.PathExists, { path: gitDir })
                if (!hasGit) {
                    logger.warn(`[SelectionContext] Worktree is not properly initialized for session ${sel.payload}: ${worktreePath}`)
                    return ids
                }
            } catch (_e) {
                logger.warn(`[SelectionContext] Could not verify worktree path for session ${sel.payload}:`, _e)
                return ids
            }

            await createTerminal(ids.top, worktreePath)
            // Proactively close legacy base bottom terminals if they exist to avoid orphans
            try {
                const legacyExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: ids.bottomBase })
                if (legacyExists) {
                    await invoke(TauriCommands.CloseTerminal, { id: ids.bottomBase })
                    terminalsCreated.current.delete(ids.bottomBase)
                }
            } catch (_e) {
                logger.warn(`[SelectionContext] Failed to cleanup legacy bottom terminal for ${sel.payload}:`, _e)
            }
            // Bottom terminals are managed by TerminalTabs (tabbed: -bottom-0, -bottom-1, ...)
            // Do not create the base bottom terminal here to avoid orphan terminals
            // Return TerminalSet with the correct working directory
            return {
                ...ids,
                workingDirectory: worktreePath
            }
            } catch (_e) {
                logger.error('[SelectionContext] Failed to inspect session state; not creating terminals for failed session lookup', _e)
                setIsSpec(false)
                // Don't create terminals if we can't determine session state
                return ids
            }
    }, [getTerminalIds, createTerminal, projectPath])
    
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
                const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: remembered.payload })
                const worktreePath = sessionData?.worktree_path || remembered.worktreePath

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
                    sessionState: sessionData?.session_state
                }
            } catch (error) {
                logger.info(`[SelectionContext] Session ${remembered.payload} no longer exists, falling back to orchestrator`, error)
                // Session doesn't exist anymore, fallback to orchestrator
                return { kind: 'orchestrator' }
            }
        }

        // Default fallback
        return { kind: 'orchestrator' }
    }, [])
    
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
        ;(setSelection as any).lastTokenWasAutoRef = (setSelection as any).lastTokenWasAutoRef || { current: false }
        ;(setSelection as any).lastTokenWasAutoRef.current = isAuto
        if (!isAuto) {
            lastUserSelectionEpochRef.current = projectEpochRef.current
            // Track most recent user token to prioritize over auto-restores
            ;(setSelection as any).lastUserTokenRef = (setSelection as any).lastUserTokenRef || { current: 0 }
            ;(setSelection as any).lastUserTokenRef.current = callToken
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
                        try {
                            const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: newSelection.payload })
                            resolvedState = resolvedState || (sessionData?.session_state as 'spec' | 'running' | 'reviewed' | undefined)
                            resolvedWorktree = resolvedWorktree || sessionData?.worktree_path
                        } catch (e) {
                            logger.warn('[SelectionContext] Failed to resolve session state for optimistic switch:', e)
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
        
        try {
            // If forcing recreate, clear terminal tracking and close old terminals first
            if (forceRecreate) {
                const ids = getTerminalIds(newSelection)
                await clearTerminalTracking([ids.top])
            }
            
            // If terminal already exists, update state immediately for instant switch
            if (terminalAlreadyExists && !forceRecreate) {
                // If this is an auto-restore and a newer user selection occurred, skip applying
                const lastUserToken = ((setSelection as any).lastUserTokenRef?.current ?? 0) as number
                if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                    return
                }
                // Ensure we have authoritative state when sessionState is unknown
                if (newSelection.kind === 'session') {
                    let resolvedState = newSelection.sessionState
                    let resolvedWorktree = newSelection.worktreePath
                    if (!resolvedState) {
                        try {
                            const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: newSelection.payload })
                            resolvedState = sessionData?.session_state as 'spec' | 'running' | 'reviewed' | undefined
                            resolvedWorktree = resolvedWorktree || sessionData?.worktree_path
                        } catch (_e) {
                            logger.warn('[SelectionContext] Failed to resolve session state during immediate switch:', _e)
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
                
                // Finalize immediate switch
                finalizeSelectionChange(newSelection)
                return
            }
            
            // For new terminals, create them first
            const terminalIds = await ensureTerminals(newSelection)
            // If another selection superseded this call, abandon applying its result
            if (callToken !== selectionTokenRef.current) {
                const lastWasAuto = ((setSelection as any).lastTokenWasAutoRef?.current ?? false) as boolean
                // Allow user selection to continue even if an auto selection bumped the token
                if (!( !isAuto && lastWasAuto )) {
                    return
                }
            }
            // If this is an auto-restore and a newer user selection occurred while creating, skip applying
            const lastUserToken = ((setSelection as any).lastUserTokenRef?.current ?? 0) as number
            if (isAuto && (lastUserToken > callToken || lastUserSelectionEpochRef.current === projectEpochRef.current)) {
                return
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

        } catch (_e) {
            logger.error('[SelectionContext] Failed to set selection:', _e)
            // Stay on current selection if we fail
            setIsReady(true)
        } finally {
            // Always finalize selection changes and clear transient flags
            finalizeSelectionChange(newSelection)
            if (isIntentional) {
                suppressAutoRestoreRef.current = false
            }
            if (!isAuto) userSelectionInFlightRef.current = false
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, projectPath, isSpec, setCurrentSelection, finalizeSelectionChange])

    // React to backend session refreshes (e.g., spec -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async () => {
                    if (selection.kind !== 'session' || !selection.payload) return
                    try {
                        const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: selection.payload })
                        const state: string | undefined = sessionData?.session_state
                        const worktreePath: string | undefined = sessionData?.worktree_path
                        const nowSpec = state === 'spec'
                        const wasSpec = isSpec

                        // Update isSpec state
                        setIsSpec(!!nowSpec)

                        // If state changed from spec to running, update selection and ensure terminals
                        if (wasSpec && !nowSpec) {
                            // Session became running - update the selection's sessionState
                            const updatedSelection = {
                                ...selection,
                                sessionState: state as 'spec' | 'running' | 'reviewed' | undefined,
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
    }, [selection, ensureTerminals, getTerminalIds, isSpec])
    
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

            // Ensure orchestrator terminals use project-specific IDs on init
            // Signal readiness only after the top terminal reports ready to avoid race in tests
            try {
                if (selection.kind === 'orchestrator') {
                    const ids = getTerminalIds({ kind: 'orchestrator' })
                    setTerminals(ids)
                    await ensureTerminals({ kind: 'orchestrator' })
                    
                    const expectedTopId = ids.top
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
            return
        }
        
        // Only run if not currently initializing
        initialize().catch(_e => {
            logger.error('[SelectionContext] Failed to initialize:', _e)
            // Still mark as ready even on error so UI doesn't hang
            setIsReady(true)
        })
    }, [projectPath, setSelection, getTerminalIds, validateAndRestoreSelection, getDefaultSelection, selection, ensureTerminals]) // Re-run when projectPath changes
    
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
                        let targetIsSpec = target.sessionState === 'spec'

                        // If the event didn't include sessionState, resolve it
                        if (target.sessionState === undefined) {
                            try {
                                const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: target.payload })
                                targetIsSpec = sessionData?.session_state === 'spec'
                            } catch (_e) {
                                logger.warn('[SelectionContext] Failed to resolve session state for backend selection event:', _e)
                            }
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
                        try {
                            const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: target.payload })
                            target = {
                                ...target,
                                sessionState: sessionData?.session_state as 'spec' | 'running' | 'reviewed' | undefined,
                                worktreePath: sessionData?.worktree_path || target.worktreePath
                            }
                        } catch (_e) {
                            logger.warn('[SelectionContext] Failed to resolve state for backend selection event:', _e)
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
    }, [setSelection, selection, isSpec, filterMode, isAnyModalOpen])

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
